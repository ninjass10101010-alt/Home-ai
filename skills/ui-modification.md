# 🎨 Skill: UI Modification & React Code

## Golden Rules for Editing `.tsx` files

1. **Never edit blindly.** Request and read the target file completely before deciding what to modify.
2. **Minimal modifications.** Only replace the exact lines needed. Preserve existing imports, hooks, and logic.
3. **No duplicate declarations.** Never duplicate `const` or `let` variables in the same scope. This will break the Next.js build.
4. **Eastern Time:** Use America/Detroit for all timestamps: `new Date().toLocaleString("en-US", { timeZone: "America/Detroit" })`.

## Real-Time Subscription Standard

Every page showing live data MUST have this exact pattern:

```tsx
"use client";
import { useState, useEffect } from "react";
import pb from "@/lib/pocketbase";

export default function MyPage() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await pb.collection("my_collection").getFullList({ sort: "-created" });
        setItems(data);
      } catch (e) {
        console.error("Failed to fetch:", e);
      }
    };

    fetchData();

    // Listen for live updates
    pb.collection("my_collection").subscribe("*", fetchData);

    // Cleanup to prevent memory leaks
    return () => {
      pb.collection("my_collection").unsubscribe("*");
    };
  }, []);

  return <div>{items.map(item => <p key={item.id}>{item.name}</p>)}</div>;
}
```

## Soul.md Updates
To update Consuela's personality or rules, issue a `write_file` action targeting `soul.md`. Personality updates take effect immediately on the next chat message—no rebuild is required.
