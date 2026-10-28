// A stand-in for the Tavora service's game search, so tests can see online
// games next to the built-in ones without the network.
import { createServer, type Server } from "node:http";

export interface FakeGame {
  id: string;
  name: string;
}

/** Answers /v1/games/search with the games whose name contains the typed text; anything else is 404. */
export async function gameService(games: FakeGame[]): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://games");
    if (url.pathname !== "/v1/games/search") {
      response.writeHead(404);
      response.end();
      return;
    }
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const results = games.filter((game) => game.name.toLowerCase().includes(q)).map((game) => ({ ...game, steamAppId: null }));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ results }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, server };
}
