import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "48px 20px",
      }}
    >
      <SignIn />
    </main>
  );
}
