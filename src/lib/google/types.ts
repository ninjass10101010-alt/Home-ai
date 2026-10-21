export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  etag?: string;
  updated?: string;
  htmlLink?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
}

export interface GoogleTaskList {
  id: string;
  title: string;
  updated?: string;
  selfLink?: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  completed?: string;
  updated?: string;
  etag?: string;
  parent?: string;
  position?: string;
  links?: { type: string; link: string; description?: string }[];
}
