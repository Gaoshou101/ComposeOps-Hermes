<template>
  <div class="page-converter">
    <div class="page-header">
      <div>
        <h1 class="page-title">Docker Run 转换器</h1>
        <p class="page-subtitle">将 docker run 命令快速转换为 docker-compose.yml</p>
      </div>
    </div>

    <div class="converter-container">
      <DockerRunConverter />
    </div>

    <div class="examples-section">
      <h3 class="examples-title">常用示例</h3>
      <div class="examples-grid">
        <button
          v-for="example in examples"
          :key="example.name"
          @click="loadExample(example.command)"
          class="example-card"
        >
          <div class="example-name">{{ example.name }}</div>
          <div class="example-command">{{ example.command }}</div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import DockerRunConverter from '../components/DockerRunConverter.vue';

const examples = [
  {
    name: 'Nginx Web 服务器',
    command: 'docker run -d --name nginx-web -p 80:80 -v /var/www:/usr/share/nginx/html nginx:alpine',
  },
  {
    name: 'PostgreSQL 数据库',
    command: 'docker run -d --name postgres-db -p 5432:5432 -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=myapp -v pgdata:/var/lib/postgresql/data postgres:15',
  },
  {
    name: 'Redis 缓存',
    command: 'docker run -d --name redis-cache -p 6379:6379 --restart unless-stopped redis:7-alpine redis-server --appendonly yes',
  },
  {
    name: 'Node.js 应用',
    command: 'docker run -d --name node-app -p 3000:3000 -e NODE_ENV=production -v /app/logs:/usr/src/app/logs node:18-alpine npm start',
  },
];

function loadExample(command) {
  // 通过事件通知 DockerRunConverter 组件
  window.dispatchEvent(new CustomEvent('load-docker-command', { detail: command }));
}
</script>

<style scoped>
.page-converter {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 24px;
  min-height: 100vh;
  background: #05070C;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-title {
  color: #F3F4F6;
  font-size: 32px;
  font-weight: 600;
  margin-bottom: 8px;
}

.page-subtitle {
  color: #9CA3AF;
  font-size: 16px;
}

.converter-container {
  background: #0A0D12;
  border: 1px solid #1E2636;
  border-radius: 12px;
  padding: 32px;
}

.examples-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.examples-title {
  color: #F3F4F6;
  font-size: 18px;
  font-weight: 500;
}

.examples-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.example-card {
  padding: 16px;
  background: #0F131C;
  border: 1px solid #1E2636;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}

.example-card:hover {
  background: #161D2B;
  border-color: #38BDF8;
}

.example-name {
  color: #F3F4F6;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
}

.example-command {
  color: #6B7280;
  font-size: 12px;
  font-family: 'Cascadia Code', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
