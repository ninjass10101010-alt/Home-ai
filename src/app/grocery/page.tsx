"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GroceryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/meals?tab=grocery");
  }, [router]);
  return null;
}
