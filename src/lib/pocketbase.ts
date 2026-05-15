import PocketBase from 'pocketbase';

// Connect to the PocketBase instance running on the NAS via Docker
// The NEXT_PUBLIC_PB_URL should be set in .env.local, 
// e.g., NEXT_PUBLIC_PB_URL=http://192.168.0.27:8090
const pbUrl = process.env.NEXT_PUBLIC_PB_URL || 'http://192.168.0.27:8090';

// Global singleton instance for the server, or a simple instance for client
// Note: If using inside Server Actions or SSR, it's recommended to create a new instance 
// per request or handle auth store correctly to avoid leaking state.
const pb = new PocketBase(pbUrl);

// Optional: Disable auto-cancellation for Next.js SSR / Server Components
pb.autoCancellation(false);

export default pb;
