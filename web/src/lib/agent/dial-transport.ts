import type { JSONRPCMessage, MCPTransport } from '@ai-sdk/mcp';
import { validateJSONRPCMessage } from '@ai-sdk/mcp';
import type { Held } from '@/lib/agent/relay';

/**
 * Speaking MCP down a connection the CLI opened.
 *
 * The AI SDK's own transports are both client-reaches-server, which is the one thing
 * decision 24 says cannot happen here. This is the same protocol with the socket the
 * other way up: a frame the agent sends goes out over the held response, and a frame
 * coming back arrives as a POST that the relay hands to `onmessage`.
 *
 * There is no `start` work to do. By the time anything constructs this the CLI has
 * already connected, which is the difference between a dial and an address: a held
 * connection is proof of reachability, where `127.0.0.1:PORT` in a table is a claim.
 */
export class DialTransport implements MCPTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private closed = false;

  constructor(private readonly conn: Held) {}

  async start(): Promise<void> {
    this.conn.listen((frame) => {
      if (this.closed) return;
      try {
        this.onmessage?.(validateJSONRPCMessage(JSON.parse(frame)));
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error('the dial to this machine has closed');
    // One line per frame, and no newline inside one: the CLI splits the stream on
    // newlines before it decodes.
    if (!this.conn.send(JSON.stringify(message))) {
      this.closed = true;
      this.onclose?.();
      throw new Error('the machine hung up mid-request');
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // The dial itself is left open. It belongs to the CLI's process, not to one
    // research turn, and the next turn wants it still there.
    this.onclose?.();
  }
}
