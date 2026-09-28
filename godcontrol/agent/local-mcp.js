'use strict';

class LocalMcpClient {
  constructor({ url, token }) {
    this.url = url;
    this.token = token;
    this.sessionId = null;
    this.counter = 1;
  }

  headers() {
    const headers = { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' };
    if (this.token) headers.authorization = 'Bearer ' + this.token;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    return headers;
  }

  async post(payload) {
    const res = await fetch(this.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('Local MCP HTTP ' + res.status);
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data: '));
    return JSON.parse(dataLine ? dataLine.slice(6) : text);
  }

  async initialize() {
    if (this.sessionId) return;
    const init = await this.post({
      jsonrpc: '2.0', id: this.counter++, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'godcontrol-agent', version: '0.1.0' } },
    });
    if (init?.error) throw new Error(init.error.message || 'Local MCP initialize failed');
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async call(name, args) {
    await this.initialize();
    const result = await this.post({ jsonrpc: '2.0', id: this.counter++, method: 'tools/call', params: { name, arguments: args || {} } });
    if (result?.error) throw new Error(result.error.message || 'Local MCP call failed');
    const toolResult = result?.result;
    if (toolResult?.isError) {
      const message = toolResult.content?.map((x) => x.text).filter(Boolean).join('\n') || 'Local MCP tool error';
      throw new Error(message);
    }
    return toolResult?.structuredContent ?? toolResult?.content ?? toolResult;
  }
}

module.exports = { LocalMcpClient };
