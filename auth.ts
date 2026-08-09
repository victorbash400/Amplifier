import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [Credentials({
    credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
    async authorize(credentials) {
      const email = typeof credentials.email === "string" ? credentials.email : "";
      const password = typeof credentials.password === "string" ? credentials.password : "";
      const backendUrl = process.env.AMPLIFIER_BACKEND_URL || "http://127.0.0.1:8000";
      const response = await fetch(`${backendUrl.replace(/\/$/, "")}/accounts/authenticate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error("Amplifier account service is unavailable");
      return response.json();
    },
  })],
  pages: { signIn: "/sign-in" },
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) { if (user) token.id = user.id; return token; },
    session({ session, token }) { if (session.user && typeof token.id === "string") session.user.id = token.id; return session; },
  },
});
