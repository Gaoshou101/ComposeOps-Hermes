import docker from './docker.js';

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_WORKDIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_CONFIG_LABEL = 'com.docker.compose.project.config_files';
const OWNER_LABEL = 'myops.owner';
const UNCATEGORIZED = 'Uncategorized';

/**
 * 扫描全机 Compose 容器，按 myops.owner 标签分组。
 *
 * 判定标准：过滤包含 com.docker.compose.project 标签的容器。
 * 项目唯一标识：com.docker.compose.project.working_dir
 * Owner 来源：myops.owner 标签，缺失归类为 Uncategorized。
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

  // 计算每个 project 的状态：running | stopped | partial
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

export { OWNER_LABEL, UNCATEGORIZED };
