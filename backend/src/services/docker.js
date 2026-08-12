import Docker from 'dockerode';

// 通过 /var/run/docker.sock 连接 Docker Engine
// 兼容 WSL / 自定义 host（DOCKER_HOST 环境变量）
const docker = new Docker();

export default docker;
