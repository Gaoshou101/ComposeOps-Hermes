# Docker 构建国内网络优化

## 问题

默认 Dockerfile 使用 `deb.debian.org` 作为 apt 源,国内直连经常超时:

```
Err:4 http://deb.debian.org/debian bookworm/main amd64 Packages
  Connection timed out [IP: 146.75.46.132 80]
```

## 解决方案

### 方案 1: 使用清华镜像源(推荐)

```bash
docker compose build --build-arg APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
```

### 方案 2: 永久启用(修改 docker-compose.yml)

取消 `docker-compose.yml` 中的注释:

```yaml
services:
  opsdash:
    build:
      context: .
      args:
        APT_MIRROR: mirrors.tuna.tsinghua.edu.cn
```

然后正常构建:

```bash
docker compose up -d --build
```

### 方案 3: 使用代理

如果你有代理(例如 Clash):

```bash
export HTTPS_PROXY=http://127.0.0.1:7897
docker compose build
```

BuildKit 会自动透传 `HTTP_PROXY`/`HTTPS_PROXY` 到构建阶段。

## 可用镜像源

- 清华: `mirrors.tuna.tsinghua.edu.cn`
- 中科大: `mirrors.ustc.edu.cn`
- 阿里云: `mirrors.aliyun.com`
- 网易: `mirrors.163.com`

## 验证

构建成功后,镜像内 apt 源已切换:

```bash
docker run --rm composeops/opsdash:latest cat /etc/apt/sources.list.d/debian.sources | grep URIs
# 应输出: URIs: http://mirrors.tuna.tsinghua.edu.cn/debian
```
