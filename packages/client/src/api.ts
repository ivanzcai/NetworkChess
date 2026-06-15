export type Difficulty = 'easy' | 'medium' | 'hard';

export interface GameResponse {
  id: string;
  fen: string;
  turn: 'w' | 'b';
  status: { type: string; color?: string; winner?: string; reason?: string };
  legalMoves: { from: number; to: number; promotion: string | null }[];
  moveHistory: { from: number; to: number; promotion: string | null; san: string }[];
  capturedPieces: { w: { type: string; color: string }[]; b: { type: string; color: string }[] };
  gameType: 'pve' | 'pvp';
  playerColor: 'w' | 'b';
  difficulty: Difficulty;
  fullMoveNumber: number;
  yourColor?: 'w' | 'b';
}

const BASE_URL = '/api';

export async function createGame(gameType: 'pve' | 'pvp' = 'pve', playerColor: 'w' | 'b' = 'w', difficulty: Difficulty = 'medium'): Promise<GameResponse> {
  const res = await fetch(`${BASE_URL}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameType, playerColor, difficulty }),
  });
  if (!res.ok) throw new Error('Failed to create game');
  return res.json();
}

export async function joinGame(gameId: string): Promise<GameResponse> {
  const res = await fetch(`${BASE_URL}/games/${gameId}/join`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to join game');
  }
  return res.json();
}

export async function getGame(id: string): Promise<GameResponse> {
  const res = await fetch(`${BASE_URL}/games/${id}`);
  if (!res.ok) throw new Error('Game not found');
  return res.json();
}

export async function makeMove(
  id: string,
  from: number,
  to: number,
  promotion?: string
): Promise<GameResponse> {
  const res = await fetch(`${BASE_URL}/games/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, promotion }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Invalid move');
  }
  return res.json();
}

export function subscribeToGame(
  id: string,
  onUpdate: (game: GameResponse) => void,
  onError?: (err: Event) => void
): () => void {
  const eventSource = new EventSource(`${BASE_URL}/games/${id}/stream`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    onUpdate(data);
  };

  eventSource.onerror = (err) => {
    if (onError) onError(err);
  };

  return () => eventSource.close();
}
