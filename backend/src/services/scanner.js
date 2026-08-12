import { access } from 'fs/promises';
import docker from './docker.js';

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_WORKDIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_CONFIG_LABEL = 'com.docker.compose.project.config_files';
const OWNER_LABEL = 'myops.owner';
const UNCATEGORIZED = 'Uncategorized';

/**
 * 判断宿主机路径在当前进程文件系统里是否可达（容器化下取决于是否 bind-mount）。
 * 只读检查（R_OK），不抛错；不可达返回 false。
 */
async function isReachable(p) {
  if (!p) return false;
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 扫描全机 Compose 容器，按 myops.owner 标签分组。
 *
 * 判定标准：过滤包含 com.docker.compose.project 标签的容器。
 * 项目唯一标识：com.docker.compose.project.working_dir
 * Owner 来源：myops.owner 标签，缺失归类为 Uncategorized。
 *
 * 可达性：每个项目检查其 composeFile / workingDir 在当前进程文件系统中
 * 是否可达（容器化下需把对应宿主机目录 bind-mount 进来）。不可达的项目仍展示，
 * 但 editable=false，前端据此禁用编辑/生命周期按钮。
 *
 * @returns {Promise<{owners: string[], groupedByOwner: Object}>}
 */
export async function scanAndGroupServices() {
  const containers = await docker.listContainers({ all: true });

  // 按 compose project 分组（以 workingDir 为 key）
  const projects = new Map();

  for (const c of containers) {
    const labels = c.Labels || {};
    const projectName = labels[COMPOSE_PROJECT_LABEL];
    if (!projectName) continue; // 非 compose 容器，跳过

    const workingDir = labels[COMPOSE_WORKDIR_LABEL] || '';
    const composeFileRaw = labels[COMPOSE_CONFIG_LABEL] || '';
    // config_files 可能是 "/path/docker-compose.yml" 或多个 ":" 分隔
    const composeFile = composeFileRaw.split(':')[0] || (workingDir ? `${workingDir}/docker-compose.yml` : '');
    const owner = labels[OWNER_LABEL] || UNCATEGORIZED;
    const key = workingDir || `${owner}/${projectName}`;

    if (!projects.has(key)) {
      projects.set(key, {
        projectName,
        owner,
        workingDir,
        composeFile,
        containers: [],
      });
    }

    const project = projects.get(key);
    project.containers.push({
      id: c.Id,
      name: (c.Names[0] || '').replace(/^\//, ''),
      state: c.State,
      statusText: c.Status,
      image: c.Image,
    });
  }

  // 计算每个 project 的状态：running | stopped | partial + 可达性检查
  const groupedByOwner = {};
  const ownerSet = new Set();

  for (const project of projects.values()) {
    const runningCount = project.containers.filter(c => c.state === 'running').length;
    if (runningCount === project.containers.length) {
      project.status = 'running';
    } else if (runningCount === 0) {
      project.status = 'stopped';
    } else {
      project.status = 'partial';
    }

    // 容器化下，workingDir 是宿主机路径；只有挂载进来的才可达 → 才能编辑/执行生命周期。
    project.editable = await isReachable(project.composeFile);

    const owner = project.owner;
    if (!groupedByOwner[owner]) groupedByOwner[owner] = [];
    groupedByOwner[owner].push(project);
    ownerSet.add(owner);
  }

  // 排序 owner，Uncategorized 放最后
  const owners = [...ownerSet].sort((a, b) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });

  return { owners, groupedByOwner };
}

/**
 * 扫描当前所有 compose 项目的 workingDir（宿主机路径集合）。
 * 供 compose 路由做 allowlist：只放行 Docker 自己上报的路径，不依赖配置。
 */
export async function discoverComposeRoots() {
  const containers = await docker.listContainers({ all: true });
  const roots = new Set();
  for (const c of containers) {
    const labels = c.Labels || {};
    if (!labels[COMPOSE_PROJECT_LABEL]) continue;
    const workingDir = labels[COMPOSE_WORKDIR_LABEL] || '';
    if (workingDir) roots.add(workingDir);
  }
  return [...roots];
}

export { OWNER_LABEL, UNCATEGORIZED };
