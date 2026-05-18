import PocketBase from 'pocketbase';

// Connect to the PocketBase instance running on the NAS via Docker
const pbUrl = process.env.NEXT_PUBLIC_PB_URL || 'http://192.168.0.27:8090';

// Singleton with SSR guard — prevents re-creation on every module load in Next.js
const globalForPb = globalThis as unknown as { _pb: PocketBase };

if (!globalForPb._pb) {
  globalForPb._pb = new PocketBase(pbUrl);
  globalForPb._pb.autoCancellation(false);
}

const pb = globalForPb._pb;

export default pb;
