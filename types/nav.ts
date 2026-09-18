export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Today", icon: "sun" },
  { href: "/reminders", label: "Reminders", icon: "bell" },
  { href: "/payments", label: "Payments", icon: "credit-card" },
  { href: "/tasks", label: "Tasks", icon: "check-square" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/assistant", label: "Assistant", icon: "message-circle" },
  { href: "/history", label: "History", icon: "clock" },
  { href: "/settings", label: "Settings", icon: "settings" },
];
