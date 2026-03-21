import { useEffect } from "react";
import { Form, Link, Outlet, useLoaderData, useLocation, type LoaderFunctionArgs } from "react-router";
import {
  BookHeart,
  Home,
  Images,
  LayoutDashboard,
  LogIn,
  LogOut,
  MessageSquare,
  Phone,
  ShoppingCart,
  Settings,
  User,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

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
import { getSession } from "~/lib/auth.server";
import { commitSession, getFlashSession } from "~/lib/session.server";

export type LoaderData = {
  toastMessage: {
    type: "success" | "error" | "info" | "warning";
    message: string;
  } | null;
  user: {
    name: string;
    phoneNumber: string;
    role: "USER" | "MEMBER" | "ADMIN" | null;
  } | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await getSession(request);
  const user = session.user;

  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  const toastMessage = flashSession.get("toast") || null;
  flashSession.unset("toast");

  const data: LoaderData = { toastMessage, user };

  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": await commitSession(flashSession),
    },
  });
};

function Header() {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
      <div className="h-16 flex items-center justify-between px-4 relative max-w-md mx-auto">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="Stampify Logo" className="h-16 w-auto" />
        </Link>

        <div className="absolute left-1/2 -translate-x-1/2">
          <h1 className="text-lg font-bold text-gray-900">Stamp App</h1>
        </div>

        <div className="w-8" />
      </div>
    </header>
  );
}

function BottomNav({ user }: { user: LoaderData["user"] }) {
  const { pathname } = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  const getNavLinkClass = (path: string) =>
    `flex flex-col items-center gap-1 py-1.5 px-1 rounded-md transition-colors duration-200 ${
      isActive(path) ? "text-primary bg-green-100" : "text-gray-600 hover:text-primary hover:bg-gray-100"
    }`;

  return (
    <nav className="bg-white border-t border-gray-200 sticky bottom-0 z-10 shadow-sm">
      <div className="h-16 grid grid-cols-5 items-center max-w-md mx-auto px-1">
        <Link to="/" className={getNavLinkClass("/")}>
          <Home size={20} />
          <span className="text-[11px] font-medium">홈</span>
        </Link>
        <Link to="/events" className={getNavLinkClass("/events")}>
          <BookHeart size={20} />
          <span className="text-[11px] font-medium">이벤트</span>
        </Link>
        <Link to="/albums" className={getNavLinkClass("/albums")}>
          <Images size={20} />
          <span className="text-[11px] font-medium">앨범</span>
        </Link>
        <Link to="/community" className={getNavLinkClass("/community")}>
          <MessageSquare size={20} />
          <span className="text-[11px] font-medium">커뮤니티</span>
        </Link>

        {user ? (
          <Sheet>
            <SheetTrigger asChild>
              <button type="button" className={getNavLinkClass("/mypage")}>
                <User size={20} />
                <span className="text-[11px] font-medium">내정보보기</span>
              </button>
            </SheetTrigger>
            <SheetContent className="w-[300px] sm:w-[400px]">
              <SheetHeader className="mb-6">
                <SheetTitle className="text-2xl font-bold text-gray-800">{user.name}님</SheetTitle>
                <SheetDescription asChild>
                  <div className="text-gray-600 text-base">
                    <div className="flex items-center gap-2 mt-2">
                      <Phone size={16} className="text-gray-500" /> {user.phoneNumber}
                    </div>
                  </div>
                </SheetDescription>
              </SheetHeader>

              <div className="grid gap-4 py-4">
                {user.role === "ADMIN" && (
                  <SheetClose asChild>
                    <Button variant="outline" asChild className="justify-start">
                      <Link to="/admin" className="text-gray-800">
                        <LayoutDashboard className="mr-2 h-5 w-5" /> 관리자 페이지
                      </Link>
                    </Button>
                  </SheetClose>
                )}

                <SheetClose asChild>
                  <Button variant="outline" asChild className="justify-start">
                    <Link to="/albums" className="text-gray-800">
                      <Images className="mr-2 h-5 w-5 text-gray-600" /> 앨범 보기
                    </Link>
                  </Button>
                </SheetClose>

                <SheetClose asChild>
                  <Button variant="outline" asChild className="justify-start">
                    <Link to="/community" className="text-gray-800">
                      <MessageSquare className="mr-2 h-5 w-5 text-gray-600" /> 커뮤니티
                    </Link>
                  </Button>
                </SheetClose>

                <SheetClose asChild>
                  <Button variant="outline" asChild className="justify-start">
                    <Link to="/card" className="text-gray-800">
                      <ShoppingCart className="mr-2 h-5 w-5 text-gray-600" /> 스탬프카드
                    </Link>
                  </Button>
                </SheetClose>

                <SheetClose asChild>
                  <Button variant="outline" asChild className="justify-start">
                    <Link to="/ledger" className="text-gray-800">
                      <Wallet className="mr-2 h-5 w-5 text-gray-600" /> 내 가계부
                    </Link>
                  </Button>
                </SheetClose>

                <SheetClose asChild>
                  <Button variant="outline" asChild className="justify-start">
                    <Link to="/mypage" className="text-gray-800">
                      <Settings className="mr-2 h-5 w-5 text-gray-600" /> 내정보 보기
                    </Link>
                  </Button>
                </SheetClose>

                <Form action="/logout" method="post" className="mt-4">
                  <Button type="submit" variant="destructive" className="w-full justify-start">
                    <LogOut className="mr-2 h-5 w-5" /> 로그아웃
                  </Button>
                </Form>
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          <Link to="/login" className={getNavLinkClass("/login")}>
            <LogIn size={20} />
            <span className="text-[11px] font-medium">로그인</span>
          </Link>
        )}
      </div>
    </nav>
  );
}

export default function MobileLayout() {
  const { user, toastMessage } = useLoaderData<LoaderData>();
  const { pathname } = useLocation();
  const hideChrome = pathname.startsWith("/ledger");

  useEffect(() => {
    if (!toastMessage) return;
    if (toastMessage.type === "success") {
      toast.success(toastMessage.message);
      return;
    }
    if (toastMessage.type === "error") {
      toast.error(toastMessage.message);
      return;
    }
    toast(toastMessage.message);
  }, [toastMessage]);

  return (
    <div className={hideChrome ? "min-h-screen bg-white flex flex-col" : "max-w-md mx-auto bg-gray-50 min-h-screen flex flex-col"}>
      {!hideChrome && <Header />}
      <main className="flex-1">
        <Outlet />
      </main>
      {!hideChrome && <BottomNav user={user} />}
      <Toaster richColors />
    </div>
  );
}


