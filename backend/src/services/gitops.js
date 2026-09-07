/**
 * GitOps 集成服务
 * 
 * 功能：
 * - Git 仓库自动同步（docker-compose.yml、.env 文件）
 * - 变更自动部署（检测到提交后自动拉取并重启服务）
 * - 版本回滚（通过 Git 历史快速回退到任意版本）
 * - 多环境配置（dev/staging/prod 分支映射）
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSetting, setSetting } from '../lib/db.js';
import { sendNotification } from './notifications.js';

const GITOPS_CONFIG_KEY = 'gitops.repositories';
const POLL_INTERVAL_KEY = 'gitops.poll_interval';
const DEFAULT_POLL_INTERVAL = 300; // 5 分钟

const activeWatchers = new Map(); // repoId -> { interval, syncing }

/** 防止同一仓库的自动同步在上一轮未结束时被下一轮并发触发(git 操作竞态)。 */
function withSyncGuard(repoId, fn) {
  const watcher = activeWatchers.get(repoId);
  if (watcher?.syncing) return null;
  if (watcher) watcher.syncing = true;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (watcher) watcher.syncing = false;
    });
}

/**
 * 读取 GitOps 配置
 * @returns {Array<{id, name, url, branch, localPath, projectId, autoSync, sshKey, lastSync, lastCommit}>}
 */
export function listGitOpsRepos() {
  try {
    const raw = getSetting(GITOPS_CONFIG_KEY, '[]');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * 保存 GitOps 配置
 */
function saveGitOpsRepos(repos) {
  setSetting(GITOPS_CONFIG_KEY, JSON.stringify(repos));
}

/**
 * 添加 Git 仓库
 * @param {{name, url, branch, localPath, projectId, autoSync, sshKey}} config
 */
export function addGitOpsRepo(config) {
  const { name, url, branch = 'main', localPath, projectId, autoSync = false, sshKey } = config;
  
  if (!name || !url || !localPath || !projectId) {
    throw Object.assign(new Error('仓库名称、URL、本地路径、项目 ID 均为必填'), { statusCode: 400 });
  }

  const repos = listGitOpsRepos();
  const id = `gitops_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // 验证本地路径不冲突
  if (repos.some((repo) => repo.localPath === localPath)) {
    throw Object.assign(new Error('本地路径已被其他 GitOps 仓库占用'), { statusCode: 400 });
  }

  const repo = {
    id,
    name,
    url,
    branch,
    localPath,
    projectId,
    autoSync,
    sshKey: sshKey || null,
    lastSync: null,
    lastCommit: null,
    status: 'pending',
  };

  repos.push(repo);
  saveGitOpsRepos(repos);

  // 如果启用自动同步，立即启动 watcher
  if (autoSync) {
    startRepoWatcher(repo);
  }

  return repo;
}

/**
 * 更新 Git 仓库配置
 */
export function updateGitOpsRepo(id, updates) {
  const repos = listGitOpsRepos();
  const index = repos.findIndex((r) => r.id === id);
  
  if (index < 0) {
    throw Object.assign(new Error('GitOps 仓库不存在'), { statusCode: 404 });
  }

  const oldRepo = repos[index];
  const newRepo = { ...oldRepo, ...updates, id: oldRepo.id }; // 禁止修改 id
  
  repos[index] = newRepo;
  saveGitOpsRepos(repos);

  // 自动同步状态变化时，重启或停止 watcher
  if (oldRepo.autoSync !== newRepo.autoSync) {
    if (newRepo.autoSync) {
      startRepoWatcher(newRepo);
    } else {
      stopRepoWatcher(id);
    }
  }

  return newRepo;
}

/**
 * 删除 Git 仓库
 */
export function deleteGitOpsRepo(id) {
  const repos = listGitOpsRepos();
  const index = repos.findIndex((r) => r.id === id);
  
  if (index < 0) {
    throw Object.assign(new Error('GitOps 仓库不存在'), { statusCode: 404 });
  }

  stopRepoWatcher(id);
  repos.splice(index, 1);
  saveGitOpsRepos(repos);

  return { ok: true };
}

/**
 * 克隆或拉取仓库
 */
export async function syncGitOpsRepo(id) {
  const repos = listGitOpsRepos();
  const repo = repos.find((r) => r.id === id);
  
  if (!repo) {
    throw Object.assign(new Error('GitOps 仓库不存在'), { statusCode: 404 });
  }

  const { url, branch, localPath, sshKey } = repo;
  const gitDir = join(localPath, '.git');
  const env = sshKey ? { ...process.env, GIT_SSH_COMMAND: `ssh -i ${sshKey} -o StrictHostKeyChecking=no` } : process.env;

  try {
    // 如果本地仓库不存在，执行 clone
    if (!existsSync(gitDir)) {
      mkdirSync(localPath, { recursive: true });
      execSync(`git clone --branch ${branch} ${url} ${localPath}`, { env, stdio: 'pipe' });
    } else {
      // 已存在则执行 pull
      execSync(`git -C ${localPath} fetch origin ${branch}`, { env, stdio: 'pipe' });
      execSync(`git -C ${localPath} reset --hard origin/${branch}`, { env, stdio: 'pipe' });
    }

    // 读取最新 commit
    const commit = execSync(`git -C ${localPath} rev-parse HEAD`, { encoding: 'utf-8', env }).trim();
    const commitMsg = execSync(`git -C ${localPath} log -1 --pretty=%B`, { encoding: 'utf-8', env }).trim();

    // 更新配置
    repo.lastSync = new Date().toISOString();
    repo.lastCommit = commit;
    repo.status = 'synced';
    saveGitOpsRepos(repos);

    return { ok: true, commit, message: commitMsg, syncedAt: repo.lastSync };
  } catch (error) {
    repo.status = 'error';
    repo.lastError = error.message;
    saveGitOpsRepos(repos);
    throw Object.assign(new Error(`Git 同步失败: ${error.message}`), { statusCode: 502 });
  }
}

/**
 * 获取 Git 历史提交记录
 */
export async function getGitOpsHistory(id, limit = 20) {
  const repos = listGitOpsRepos();
  const repo = repos.find((r) => r.id === id);
  
  if (!repo) {
    throw Object.assign(new Error('GitOps 仓库不存在'), { statusCode: 404 });
  }

  const { localPath } = repo;
  const gitDir = join(localPath, '.git');

  if (!existsSync(gitDir)) {
    return { commits: [] };
  }

  try {
    const log = execSync(
      `git -C ${localPath} log -${limit} --pretty=format:'%H|%an|%ae|%ad|%s' --date=iso`,
      { encoding: 'utf-8' }
    );

    const commits = log.split('\n').filter(Boolean).map((line) => {
      const [hash, author, email, date, ...messageParts] = line.split('|');
      return { hash, author, email, date, message: messageParts.join('|') };
    });

    return { commits };
  } catch (error) {
    throw Object.assign(new Error(`读取 Git 历史失败: ${error.message}`), { statusCode: 502 });
  }
}

/**
 * 回滚到指定 commit
 */
export async function rollbackGitOpsRepo(id, commitHash) {
  const repos = listGitOpsRepos();
  const repo = repos.find((r) => r.id === id);
  
  if (!repo) {
    throw Object.assign(new Error('GitOps 仓库不存在'), { statusCode: 404 });
  }

  const { localPath, sshKey } = repo;
  const env = sshKey ? { ...process.env, GIT_SSH_COMMAND: `ssh -i ${sshKey} -o StrictHostKeyChecking=no` } : process.env;

  try {
    execSync(`git -C ${localPath} checkout ${commitHash}`, { env, stdio: 'pipe' });
    
    const commitMsg = execSync(`git -C ${localPath} log -1 --pretty=%B`, { encoding: 'utf-8', env }).trim();

    repo.lastSync = new Date().toISOString();
    repo.lastCommit = commitHash;
    repo.status = 'synced';
    saveGitOpsRepos(repos);

    await sendNotification(
      'GitOps 版本回滚',
      `仓库 ${repo.name} 已回滚到提交 ${commitHash.slice(0, 7)}: ${commitMsg}`
    );

    return { ok: true, commit: commitHash, message: commitMsg };
  } catch (error) {
    throw Object.assign(new Error(`版本回滚失败: ${error.message}`), { statusCode: 502 });
  }
}

/**
 * 启动仓库自动同步监听
 */
function startRepoWatcher(repo) {
  if (activeWatchers.has(repo.id)) {
    return; // 已在运行
  }

  const pollInterval = Number(getSetting(POLL_INTERVAL_KEY, String(DEFAULT_POLL_INTERVAL))) * 1000;

  const interval = setInterval(() => {
    withSyncGuard(repo.id, async () => {
      try {
        const result = await syncGitOpsRepo(repo.id);
        if (result.ok && result.commit !== repo.lastCommit) {
          await sendNotification(
            'GitOps 自动同步',
            `仓库 ${repo.name} 检测到新提交 ${result.commit.slice(0, 7)}: ${result.message}`
          );
        }
      } catch (error) {
        console.error(`[GitOps] 自动同步失败 (${repo.name}):`, error.message);
      }
    });
  }, pollInterval);
  // 让 interval 不阻塞进程退出;真正的同步由 setTimeout 调度,不复用该 interval。
  interval.unref();

  activeWatchers.set(repo.id, { interval });
}

/**
 * 停止仓库自动同步监听
 */
function stopRepoWatcher(repoId) {
  const watcher = activeWatchers.get(repoId);
  if (watcher) {
    clearInterval(watcher.interval);
    activeWatchers.delete(repoId);
  }
}

/**
 * 初始化 GitOps 服务（启动所有自动同步仓库的 watcher）
 */
export function initGitOps() {
  const repos = listGitOpsRepos();
  for (const repo of repos) {
    if (repo.autoSync) {
      startRepoWatcher(repo);
    }
  }
}

/**
 * 停止所有 GitOps watcher
 */
export function stopAllGitOpsWatchers() {
  for (const [repoId] of activeWatchers) {
    stopRepoWatcher(repoId);
  }
}
