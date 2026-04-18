import { Route, Routes, Navigate } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { SignInPage } from "@/pages/SignInPage";
import { SignUpPage } from "@/pages/SignUpPage";
import { ProtectedRoutes } from "@/pages/ProtectedRoutes";
import { PayInvoicePage } from "@/pages/PayInvoicePage";

export function App() {
  return (
    <Routes>
      <Route path="/pay/:invoiceId" element={<PayInvoicePage />} />
      <Route
        path="*"
        element={
          <>
            <SignedOut>
              <Routes>
                <Route path="/sign-in/*" element={<SignInPage />} />
                <Route path="/sign-up/*" element={<SignUpPage />} />
                <Route path="*" element={<Navigate to="/sign-in" replace />} />
              </Routes>
            </SignedOut>
            <SignedIn>
              <ProtectedRoutes />
            </SignedIn>
          </>
        }
      />
    </Routes>
  );
}
