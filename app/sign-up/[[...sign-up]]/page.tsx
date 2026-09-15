import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
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
      <SignUp />
    </main>
  );
}
