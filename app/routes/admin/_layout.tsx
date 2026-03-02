import { Form, Link, Outlet, useLoaderData, useLocation, type LoaderFunctionArgs } from "react-router";
import { json } from "@remix-run/node";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  Home,
  Images,
  LogOut,
  Menu,
  Monitor,
  Package,
  ShieldCheck,
  Smartphone,
  Ticket,
  User,
  Users,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { Toaster } from "~/components/ui/sonner";
import { requireAdminAccessScope } from "~/lib/admin-access.server";
import { commitSession, getFlashSession } from "~/lib/session.server";

type LoaderData = {
  user: {
    id: string;
    name: string;
    phoneNumber: string;
    role: "USER" | "MEMBER" | "ADMIN" | null;
  };
  isAdmin: boolean;
  view: "pc" | "mobile";
  toastMessage: {
    type: "success" | "error";
    message: string;
  } | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  const url = new URL(request.url);
  const view = url.searchParams.get("view") === "pc" ? "pc" : "mobile";

  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  const toastMessage = flashSession.get("toast") || null;
  flashSession.unset("toast");

  return json(
    {
      user: scope.user,
      isAdmin: scope.isAdmin,
      view,
      toastMessage,
    } satisfies LoaderData,
    {
      headers: {
        "Set-Cookie": await commitSession(flashSession),
      },
    }
  );
};

function Header({ user, currentView }: { user: LoaderData["user"]; currentView: "pc" | "mobile" }) {
  const location = useLocation();
  const toggleView = currentView === "pc" ? "mobile" : "pc";
  const togglePath = `${location.pathname}?view=${toggleView}`;

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
      {currentView === "mobile" && (
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="shrink-0">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle navigation menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex flex-col">
            <SheetHeader className="border-b px-4 py-5 text-left">
              <SheetTitle>
                <Link to="/admin" className="flex items-center gap-2 font-semibold">
                  <Package className="h-6 w-6" />
                  <span>Admin Panel</span>
                </Link>
              </SheetTitle>
              <SheetDescription>관리 메뉴로 이동합니다.</SheetDescription>
            </SheetHeader>
            <SidebarNav inSheet isAdmin={user.role === "ADMIN"} />
          </SheetContent>
        </Sheet>
      )}

      <div className="w-full flex-1" />

      <Button variant="outline" asChild className="hidden sm:inline-flex">
        <Link to="/mypage">마이메뉴</Link>
      </Button>
      <Button variant="outline" size="icon" asChild className="sm:hidden">
        <Link to="/mypage" aria-label="마이메뉴">
          <User className="h-5 w-5" />
        </Link>
      </Button>

      <Button variant="outline" size="icon" asChild>
        <Link to={togglePath}>
          {currentView === "pc" ? <Smartphone className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
        </Link>
      </Button>

      <span className="text-sm text-muted-foreground hidden sm:inline">
        {user.name}({user.role})
      </span>
      <Form action="/logout" method="post">
        <Button variant="ghost" size="icon" type="submit" aria-label="로그아웃">
          <LogOut className="h-5 w-5" />
        </Button>
      </Form>
    </header>
  );
}

function SidebarNav({ inSheet, isAdmin }: { inSheet: boolean; isAdmin: boolean }) {
  const NavLinkWrapper = inSheet
    ? SheetClose
    : ({ children }: { children: React.ReactNode }) => <>{children}</>;

  return (
    <nav className="grid items-start px-2 text-sm font-medium lg:px-4 mt-4">
      <NavLinkWrapper asChild>
        <Link to="/admin" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary">
          <Home className="h-4 w-4" /> 대시보드
        </Link>
      </NavLinkWrapper>
      <NavLinkWrapper asChild>
        <Link to="/admin/events" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary">
          <Package className="h-4 w-4" /> 이벤트 관리
        </Link>
      </NavLinkWrapper>
      <NavLinkWrapper asChild>
        <Link to="/admin/events/stats" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary">
          <BarChart3 className="h-4 w-4" /> 이벤트 통계
        </Link>
      </NavLinkWrapper>
      <NavLinkWrapper asChild>
        <Link to="/admin/albums" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary">
          <Images className="h-4 w-4" /> 앨범 관리
        </Link>
      </NavLinkWrapper>

      {isAdmin && (
        <>
          <NavLinkWrapper asChild>
            <Link to="/admin/categories/managers" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary">
              <ShieldCheck className="h-4 w-4" /> 카테고리 운영진
            </Link>
          </NavLinkWrapper>
          <NavLinkWrapper asChild>
            <Link to="/admin/users" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary">
              <Users className="h-4 w-4" /> 회원 관리
            </Link>
          </NavLinkWrapper>
          <NavLinkWrapper asChild>
            <Link to="/admin/coupons" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary">
              <Ticket className="h-4 w-4" /> 쿠폰 관리
            </Link>
          </NavLinkWrapper>
        </>
      )}
    </nav>
  );
}

function PCLayout({
  user,
  isAdmin,
  children,
}: {
  user: LoaderData["user"];
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen w-full grid-cols-[220px_1fr]">
      <div className="border-r bg-muted/40">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
            <Link to="/admin" className="flex items-center gap-2 font-semibold">
              <Package className="h-6 w-6" />
              <span>Admin Panel</span>
            </Link>
          </div>
          <div className="flex-1">
            <SidebarNav inSheet={false} isAdmin={isAdmin} />
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <Header user={user} currentView="pc" />
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function MobileLayout({
  user,
  children,
}: {
  user: LoaderData["user"];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col w-full h-full">
      <Header user={user} currentView="mobile" />
      <main className="flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}

export default function AdminLayout() {
  const { user, isAdmin, view, toastMessage } = useLoaderData<LoaderData>();

  useEffect(() => {
    if (toastMessage?.type === "success") {
      toast.success(toastMessage.message);
    }
    if (toastMessage?.type === "error") {
      toast.error(toastMessage.message);
    }
  }, [toastMessage]);

  if (view === "pc") {
    return (
      <>
        <PCLayout user={user} isAdmin={isAdmin}>
          <Outlet />
        </PCLayout>
        <Toaster richColors />
      </>
    );
  }

  return (
    <>
      <div className="min-h-screen w-full bg-muted/40 flex justify-center">
        <div className="w-full max-w-md bg-background shadow-lg">
          <MobileLayout user={user}>
            <Outlet />
          </MobileLayout>
        </div>
      </div>
      <Toaster richColors />
    </>
  );
}

