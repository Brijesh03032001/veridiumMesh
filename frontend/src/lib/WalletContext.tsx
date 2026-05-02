"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type WalletSession = {
  address: string;
  name: string;
  role: string;
};

type WalletContextType = {
  wallet: WalletSession | null;
  connect: (wallet: WalletSession) => void;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletSession | null>(null);

  return (
    <WalletContext.Provider value={{
      wallet,
      connect: (w) => setWallet(w),
      disconnect: () => setWallet(null),
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
