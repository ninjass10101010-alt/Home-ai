export interface PlaybookRow {
  id: string;
  slug: string;
  title: string;
  domain?: string;
  trigger?: string;
  body: string;
  version: number;
  status: string;
  history: any[];
  useCount: number;
  lastUsed?: string;
  createdBy: string;
}

export async function listActivePlaybooks(): Promise<PlaybookRow[]> {
  return [];
}
