import { createContext, useContext, useState, type ReactNode } from "react";

interface FakeUser {
  email: string;
  fullName: string;
  organization: string;
  role: string;
  country: string;
}

interface AuthContextType {
  user: FakeUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => void;
  signUp: (data: FakeUser & { password: string }) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: false,
  signIn: () => {},
  signUp: () => {},
  signOut: () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FakeUser | null>(() => {
    const stored = localStorage.getItem("meta_society_user");
    return stored ? JSON.parse(stored) : null;
  });

  const signIn = (email: string, _password: string) => {
    const fakeUser: FakeUser = {
      email,
      fullName: email.split("@")[0],
      organization: "",
      role: "Analyst",
      country: "",
    };
    localStorage.setItem("meta_society_user", JSON.stringify(fakeUser));
    setUser(fakeUser);
  };

  const signUp = (data: FakeUser & { password: string }) => {
    const { password: _, ...userData } = data;
    localStorage.setItem("meta_society_user", JSON.stringify(userData));
    setUser(userData);
  };

  const signOut = () => {
    localStorage.removeItem("meta_society_user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading: false, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
