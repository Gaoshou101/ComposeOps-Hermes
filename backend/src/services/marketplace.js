/**
 * 模板市场服务
 * 支持社区模板、自定义模板、模板分享、评分与收藏
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSetting, setSetting } from './settings.js';
import { getBlueprint, listBlueprints } from './app-blueprints.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 获取社区模板列表（从远程或缓存）
 */
export async function getCommunityTemplates() {
  const cached = getSetting('marketplace.community.cache');
  const cacheTime = parseInt(getSetting('marketplace.community.cacheTime') || '0', 10);
  const now = Date.now();
  
  // 缓存有效期 24 小时
  if (cached && (now - cacheTime) < 24 * 60 * 60 * 1000) {
    try {
      return JSON.parse(cached);
    } catch {
      // 缓存损坏，继续获取新数据
    }
  }
  
  // 模拟社区模板数据（实际应从远程 API 获取）
  const templates = [
    {
      id: 'community-wordpress',
      name: 'WordPress + MySQL',
      category: 'CMS',
      description: '经典博客建站方案，社区优化配置',
      author: 'community',
      downloads: 1250,
      rating: 4.8,
      featured: true,
      defaultCompose: 'services:\n  db:\n    image: mysql:8\n    environment:\n      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}\n      MYSQL_DATABASE: wordpress\n  wordpress:\n    image: wordpress:latest\n    depends_on:\n      - db\n    ports:\n      - "${PORT}:80"\n    environment:\n      WORDPRESS_DB_HOST: db\n      WORDPRESS_DB_PASSWORD: ${DB_PASSWORD}',
      envSchema: [
        { key: 'PORT', label: '访问端口', default: '8080', type: 'port' },
        { key: 'DB_PASSWORD', label: '数据库密码', default: '', type: 'password', secret: true }
      ]
    }
  ];
  
  setSetting('marketplace.community.cache', JSON.stringify(templates));
  setSetting('marketplace.community.cacheTime', String(now));
  
  return templates;
}

/**
 * 获取自定义模板列表
 */
export async function getCustomTemplates() {
  const raw = getSetting('marketplace.custom.templates') || '[]';
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * 创建自定义模板
 */
export async function createCustomTemplate(template) {
  const { name, category, description, defaultCompose, envSchema } = template;
  
  if (!name?.trim()) throw new Error('模板名称不能为空');
  if (!defaultCompose?.trim()) throw new Error('Compose 内容不能为空');
  
  const customs = await getCustomTemplates();
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  
  const newTemplate = {
    id,
    name: name.trim(),
    category: category?.trim() || 'Custom',
    description: description?.trim() || '',
    author: 'user',
    createdAt: new Date().toISOString(),
    defaultCompose,
    envSchema: envSchema || []
  };
  
  customs.push(newTemplate);
  setSetting('marketplace.custom.templates', JSON.stringify(customs));
  
  return newTemplate;
}

/**
 * 更新自定义模板
 */
export async function updateCustomTemplate(id, updates) {
  const customs = await getCustomTemplates();
  const index = customs.findIndex(t => t.id === id);
  
  if (index === -1) throw new Error('模板不存在');
  if (!customs[index].id.startsWith('custom-')) throw new Error('只能编辑自定义模板');
  
  customs[index] = { ...customs[index], ...updates, updatedAt: new Date().toISOString() };
  setSetting('marketplace.custom.templates', JSON.stringify(customs));
  
  return customs[index];
}

/**
 * 删除自定义模板
 */
export async function deleteCustomTemplate(id) {
  const customs = await getCustomTemplates();
  const index = customs.findIndex(t => t.id === id);
  
  if (index === -1) throw new Error('模板不存在');
  if (!customs[index].id.startsWith('custom-')) throw new Error('只能删除自定义模板');
  
  customs.splice(index, 1);
  setSetting('marketplace.custom.templates', JSON.stringify(customs));
}

/**
 * 获取收藏列表
 */
export function getFavorites() {
  const raw = getSetting('marketplace.favorites') || '[]';
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * 添加收藏
 */
export function addFavorite(templateId) {
  const favorites = getFavorites();
  if (!favorites.includes(templateId)) {
    favorites.push(templateId);
    setSetting('marketplace.favorites', JSON.stringify(favorites));
  }
  return favorites;
}

/**
 * 移除收藏
 */
export function removeFavorite(templateId) {
  const favorites = getFavorites();
  const filtered = favorites.filter(id => id !== templateId);
  setSetting('marketplace.favorites', JSON.stringify(filtered));
  return filtered;
}

/**
 * 获取所有模板（内置 + 社区 + 自定义）
 */
export async function getAllTemplates() {
  const [builtin, community, custom] = await Promise.all([
    listBlueprints(),
    getCommunityTemplates(),
    getCustomTemplates()
  ]);
  
  const favorites = getFavorites();
  
  // 标记收藏状态
  const markFavorite = (template) => ({
    ...template,
    favorited: favorites.includes(template.id)
  });
  
  return {
    builtin: builtin.map(markFavorite),
    community: community.map(markFavorite),
    custom: custom.map(markFavorite)
  };
}

/**
 * 搜索模板
 */
export async function searchTemplates(query, options = {}) {
  const { category, source, onlyFavorites } = options;
  const allTemplates = await getAllTemplates();
  
  let results = [];
  
  // 根据来源筛选
  if (!source || source === 'all') {
    results = [...allTemplates.builtin, ...allTemplates.community, ...allTemplates.custom];
  } else if (source === 'builtin') {
    results = allTemplates.builtin;
  } else if (source === 'community') {
    results = allTemplates.community;
  } else if (source === 'custom') {
    results = allTemplates.custom;
  }
  
  // 收藏过滤
  if (onlyFavorites) {
    results = results.filter(t => t.favorited);
  }
  
  // 分类过滤
  if (category && category !== 'all') {
    results = results.filter(t => t.category === category);
  }
  
  // 关键词搜索
  if (query?.trim()) {
    const needle = query.trim().toLowerCase();
    results = results.filter(t =>
      `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(needle)
    );
  }
  
  return results;
}

/**
 * 获取模板统计
 */
export async function getMarketplaceStats() {
  const allTemplates = await getAllTemplates();
  const favorites = getFavorites();
  
  return {
    totalBuiltin: allTemplates.builtin.length,
    totalCommunity: allTemplates.community.length,
    totalCustom: allTemplates.custom.length,
    totalFavorites: favorites.length,
    categories: [...new Set([
      ...allTemplates.builtin.map(t => t.category),
      ...allTemplates.community.map(t => t.category),
      ...allTemplates.custom.map(t => t.category)
    ])].sort()
  };
}
