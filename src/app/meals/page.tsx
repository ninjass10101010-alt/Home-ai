import pb from "@/lib/pocketbase";
import MealsUnified from "./MealsUnified";

export const dynamic = "force-dynamic";

export default async function MealsPage() {
  let meals: any[] = [], groceryItems: any[] = [], pantryItems: any[] = [];
  try {
    [meals, groceryItems, pantryItems] = await Promise.all([
      pb.collection("meals").getFullList(),
      pb.collection("grocery_items").getFullList(),
      pb.collection("pantry_items").getFullList()
    ]);
  } catch(e) {
    console.error(e);
  }

  return (
    <MealsUnified 
      initialMeals={meals} 
      initialGrocery={groceryItems} 
      initialPantry={pantryItems} 
    />
  );
}
