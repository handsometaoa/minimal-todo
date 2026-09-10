// 模块链接检查:能走到 DOM 报错说明解析与链接均通过(浏览器环境才有 DOM)
import { pathToFileURL } from 'node:url';

const files = process.argv.slice(2);
let failed = false;

for (const file of files) {
    try {
        await import(pathToFileURL(file).href);
        console.log(`${file}: OK (loaded)`);
    } catch (error) {
        if (/document|window|localStorage is not defined/.test(error.message)) {
            console.log(`${file}: PARSE/LINK OK (DOM only)`);
        } else {
            failed = true;
            console.log(`${file}: ${error.constructor.name}: ${error.message.slice(0, 100)}`);
        }
    }
}

process.exit(failed ? 1 : 0);
