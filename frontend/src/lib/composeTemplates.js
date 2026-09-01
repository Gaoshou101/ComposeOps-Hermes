/**
 * Compose 常用服务模板:一键插入编辑器。
 * 每个模板是 services 段下的一个服务键值片段(2 空格缩进)。
 */
export const composeTemplates = [
  {
    id: 'postgres',
    label: 'PostgreSQL',
    description: '带数据卷与健康检查的 PostgreSQL 16',
    insert: `  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: myuser
      POSTGRES_PASSWORD: changeme
      POSTGRES_DB: mydb
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myuser"]
      interval: 10s
      timeout: 5s
      retries: 5`,
  },
  {
    id: 'redis',
    label: 'Redis',
    description: 'Redis 7 带密码与数据卷',
    insert: `  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass changeme --appendonly yes
    volumes:
      - redisdata:/data`,
  },
  {
    id: 'nginx',
    label: 'Nginx',
    description: '静态站点 / 反向代理',
    insert: `  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro`,
  },
  {
    id: 'healthcheck',
    label: '健康检查片段',
    description: '为已有服务追加 healthcheck(需手动合并缩进)',
    insert: `    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:80/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s`,
  },
];
