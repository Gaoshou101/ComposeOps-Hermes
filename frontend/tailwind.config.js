/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  // 深色专业控制台为唯一主题，无需 darkMode 变体开关（页面无 light 主题，也未使用 dark: 前缀）
  theme: {
    extend: {
      colors: {
        // 自定义中性灰配合 ops 风格
        surface: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d7dbe3',
          300: '#b6bdc9',
          400: '#8f99a8',
          500: '#6f7a8a',
          600: '#576071',
          700: '#454c5b',
          800: '#363c48',
          900: '#262b34',
          950: '#1a1e25',
          // 比 950 更深的面板/终端底(原散落在 style.css 的 #10141a / #0b0d10)
          975: '#10141a',
          1000: '#0b0d10',
        },
        accent: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // 状态语义光晕：运行时/成功 -> emerald，危险/失败 -> rose，信息/激活 -> accent
        'glow-emerald': '0 0 8px rgba(52, 211, 153, 0.4)',
        'glow-rose': '0 0 8px rgba(251, 113, 133, 0.4)',
        'glow-accent': '0 0 8px rgba(37, 99, 235, 0.4)',
      },
    },
  },
  plugins: [],
};
