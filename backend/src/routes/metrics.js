import { queryContainerMetrics, configureAlert, listAlerts, deleteAlert } from '../services/agent-metrics.js';

/**
 * 容器资源监控 API 路由
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function metricsRoutes(fastify) {
  // 查询容器资源指标
  fastify.get(
    '/container/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: '容器 ID 或名称' }
          }
        },
        querystring: {
          type: 'object',
          properties: {
            metric: { type: 'string', enum: ['cpu', 'memory', 'network', 'disk'], default: 'cpu' },
            period: { type: 'string', enum: ['1m', '5m', '1h', '1d'], default: '5m' }
          }
        }
      }
    },
    async (request) => {
      const { id } = request.params;
      const { metric = 'cpu', period = '5m' } = request.query;
      
      const data = await queryContainerMetrics(id, metric, period);
      return { data };
    }
  );

  // 配置告警规则
  fastify.post(
    '/alerts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['container', 'metric', 'threshold'],
          properties: {
            container: { type: 'string', description: '容器 ID 或名称' },
            metric: { type: 'string', enum: ['cpu', 'memory', 'network', 'disk'] },
            threshold: { type: 'number', description: '阈值' },
            duration: { type: 'string', description: '持续时间', default: '5m' },
            action: { type: 'string', enum: ['notify', 'restart', 'scale'], default: 'notify' }
          }
        }
      }
    },
    async (request) => {
      const result = await configureAlert(request.body);
      return result;
    }
  );

  // 列出告警规则
  fastify.get(
    '/alerts',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            container: { type: 'string', description: '容器过滤（可选）' }
          }
        }
      }
    },
    async (request) => {
      const { container } = request.query;
      const alerts = await listAlerts(container);
      return { alerts };
    }
  );

  // 删除告警规则
  fastify.delete(
    '/alerts/:ruleId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['ruleId'],
          properties: {
            ruleId: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      const { ruleId } = request.params;
      const result = await deleteAlert(ruleId);
      return result;
    }
  );
}
