import { AppModule, AppRole, navigationItems } from "@/models/navigation";

export function getNavigationForRole(role: AppRole) {
  return navigationItems.filter((item) => item.roles.includes(role));
}

export function canAccessModule(role: AppRole, module: AppModule) {
  return navigationItems.some(
    (item) => item.module === module && item.roles.includes(role)
  );
}
