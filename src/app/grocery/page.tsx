import { redirect } from "next/navigation";

export default function GroceryRedirect() {
  redirect("/meals?tab=grocery");
}
