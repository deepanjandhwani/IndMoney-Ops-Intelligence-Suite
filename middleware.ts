import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAdminLogin = pathname === "/admin/login";
  const isAdminRoute = pathname.startsWith("/admin") && !isAdminLogin;
  const isAdminApi = pathname.startsWith("/api/admin");
  const isCustomerProtected =
    pathname === "/customer" ||
    pathname.startsWith("/customer/my-bookings") ||
    pathname.startsWith("/customer/scheduler") ||
    pathname.startsWith("/customer/faq") ||
    pathname.startsWith("/customer/chat-history");
  const isCustomerLogin = pathname === "/customer/login";

  if (!isAdminRoute && !isAdminApi && !isCustomerProtected) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !anonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (isAdminRoute || isAdminApi) {
    if (!user) {
      if (isAdminApi) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      if (isAdminApi) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("error", "not_admin");
      return NextResponse.redirect(loginUrl);
    }
  }

  if (isCustomerProtected) {
    if (!user) {
      const loginUrl = new URL("/customer/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    const { data: customerGateProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (customerGateProfile?.role === "admin") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/customer",
    "/customer/my-bookings",
    "/customer/my-bookings/:path*",
    "/customer/scheduler",
    "/customer/scheduler/:path*",
    "/customer/faq",
    "/customer/faq/:path*",
    "/customer/chat-history",
    "/customer/chat-history/:path*"
  ]
};
