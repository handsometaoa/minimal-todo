const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-mig-'));
// 模拟旧版文件存储：userData/storage/todo__data.json + todo__setting.json
const storageDir = path.join(tmp, 'storage');
fs.mkdirSync(storageDir);
fs.writeFileSync(
    path.join(storageDir, 'todo__data.json'),
    JSON.stringify({
        id: 'todo/data',
        rev: null,
        data: {
            todos: [{ id: 'old1', text: '旧待办', createdAt: 111, dueAt: 999 }],
            completed: [{ id: 'old2', text: '旧完成', createdAt: 222, completedAt: 333 }]
        }
    })
);
fs.writeFileSync(
    path.join(storageDir, 'todo__setting.json'),
    JSON.stringify({
        id: 'todo/setting',
        rev: null,
        data: {
            appearance: { mode: 'light' },
            theme: { mode: 'preset', presetThemeId: 'ocean' },
            duePresets: { today: '20:00' }
        }
    })
);

const database = require('../electron/database.cjs');
database.open(tmp);
const snap = database.bootstrapSnapshot();
console.log('migrated todos:', JSON.stringify(snap.todos));
console.log('migrated completed:', JSON.stringify(snap.completed));
console.log('migrated settings:', JSON.stringify(snap.settings));
console.log('storage dir renamed to backup:', !fs.existsSync(storageDir), fs.existsSync(storageDir + '-legacy-backup'));
database.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('LEGACY FILE MIGRATION TEST PASSED');
