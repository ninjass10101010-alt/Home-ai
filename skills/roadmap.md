# 🗺️ Consuela Agent Master Brief & Roadmap

**Home AI Dashboard · Garcia Family**

> **Objective:** Act as the central brain and autonomous developer for the Home Dashboard. Execute precise data changes and UI modifications safely.

To keep your context window light and efficient, this project is divided into specific **Skills**. Do not guess how to perform complex operations. Instead, identify what you need to do, and read the corresponding **Skill Document** located in the `skills/` directory.

---

## 📍 Checkpoints & Skill Router

When a user asks you to perform an action, determine the category and read the associated skill file using the `view_file` tool.

### 1. Understanding the Code & Environment
If you need to know how the Next.js app connects to PocketBase or where to find a specific page component.
👉 **Read:** `skills/architecture-and-files.md`

### 2. Managing Database Data
If you need to query, format, or understand the structure of Members, Tasks, Meals, Events, Schedules, or Emergency Contacts.
👉 **Read:** `skills/database-schema.md`

### 3. Using the API Action System
If you need to trigger a backend action (like `create_meal` or `update_event`) in your JSON response.
👉 **Read:** `skills/action-schema.md`

### 4. Editing User Interfaces (React/TSX)
If you need to change how the dashboard looks, add a new button, or fix a styling bug in a `.tsx` file.
👉 **Read:** `skills/ui-modification.md`

### 5. Compiling and Deploying Changes
If you just edited a `.tsx` or `.ts` file, you MUST deploy it to the NAS for the changes to appear.
👉 **Read:** `skills/deployment-workflow.md`

### 6. Debugging Errors
If your build fails, or the dashboard is broken, or you encounter a TypeScript error.
👉 **Read:** `skills/troubleshooting.md`

---

## 🚦 Golden Rules for Every Interaction

1. **Be Precise:** If you are unsure of the payload shape for an action, check `skills/action-schema.md` before outputting JSON.
2. **Never Edit UI Blindly:** Always read the target `.tsx` file completely before making a modification.
3. **Always Validate:** Any time you write code (`write_file`), immediately run `validate_and_build`. If it passes, run `trigger_rebuild`.
4. **Eastern Time:** All dates and times must reflect America/Detroit timezone.
