// ESLint 平铺配置：按宿主环境分区
//   src/**          渲染进程 ES 模块（浏览器全局）
//   electron/*.cjs  Electron 主进程 / preload（Node 全局，CommonJS）
//   scripts/*.cjs   工程脚本（Node 全局，CommonJS）
//   scripts/*.mjs   工程脚本（Node 全局，ES 模块）
// 风格类规则交给 Prettier（末尾引入 eslint-config-prettier 关闭冲突规则）
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
    {
        ignores: ['node_modules/**', '.zcode/**', '.idea/**']
    },
    js.configs.recommended,
    prettier,
    {
        files: ['src/app.js', 'src/scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser
            }
        }
    },
    {
        // 主进程模块：纯 Node 环境
        files: ['electron/**/*.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node
            }
        }
    },
    {
        // preload：运行在渲染进程，Node 与浏览器全局并存
        files: ['electron/preload.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.browser
            }
        }
    },
    {
        // 工程脚本：CommonJS 与 ES 模块并存，均为 Node 环境
        files: ['scripts/**/*.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node
            }
        }
    },
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node
            }
        }
    },
    {
        rules: {
            // 未使用的函数参数多为事件签名的占位（如 _event），不视为错误
            'no-unused-vars': [
                'error',
                {
                    args: 'none',
                    caughtErrors: 'none',
                    // 解构 rest 兄弟项（如 const { dueAt, ...rest }）用于剔除字段，视为已使用
                    ignoreRestSiblings: true
                }
            ]
        }
    }
];
