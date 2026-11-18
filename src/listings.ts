import type { DatabaseSync } from 'node:sqlite';

export interface Room {
  id: string;
  name: string;
  area_m2: number | null;
}

export interface Listing {
  id: string;
  title: string;
  address: string;
  price_usd: number;
  rooms: Room[];
}

export function listListings(db: DatabaseSync, options: { limit: number }): Listing[] {
  const listings = db.prepare('SELECT id, title, address, price_usd FROM listings ORDER BY created_at, id LIMIT ?').all(options.limit);
  const findRooms = db.prepare('SELECT id, name, area_m2 FROM rooms WHERE listing_id = ? ORDER BY id');
  return listings.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    address: String(row.address),
    price_usd: Number(row.price_usd),
    rooms: findRooms.all(row.id).map((room) => ({
      id: String(room.id),
      name: String(room.name),
      area_m2: room.area_m2 === null ? null : Number(room.area_m2),
    })),
  }));
}

export function hasListing(db: DatabaseSync, id: string): boolean {
  return db.prepare('SELECT 1 FROM listings WHERE id = ?').get(id) !== undefined;
}
