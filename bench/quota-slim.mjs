import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {slimDelegateArgs} from './quota-eval-core.mjs';

const upstream = new Client({name:'quota-slim-upstream',version:'1'});
await upstream.connect(new StdioClientTransport({command:process.execPath,args:[new URL('../runtime/dist/index.js',import.meta.url).pathname],env:{...process.env,POLYAGENT_CLAUDE_MD:'off',POLYAGENT_SKILL:'off'},stderr:'ignore'}));
const server = new McpServer({name:'polyagent-quota-slim',version:'1'},{instructions:'Delegate a complete implementation or substantial investigation once; verify its outcome without repeating its exploration. Use native tools for trivial lookups and deterministic filters.'});
server.registerTool('delegate',{description:'Run one complete task on a Codex worker in this workspace. Include all requirements and expected verification in prompt. Returns result and session handle.',inputSchema:{prompt:z.string().min(1)},_meta:{'anthropic/alwaysLoad':true}},async ({prompt})=>upstream.callTool({name:'delegate',arguments:slimDelegateArgs(prompt,process.cwd())}));
await server.connect(new StdioServerTransport());
process.on('SIGTERM',async()=>{await upstream.close();await server.close();process.exit(0);});
