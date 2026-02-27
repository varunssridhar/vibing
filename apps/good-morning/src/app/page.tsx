export default function Page() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background:
          "radial-gradient(circle at top, #fef3c7 0, #fef9c3 35%, #e0f2fe 100%)",
        color: "#111827",
      }}
    >
      <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>Good Morning</h1>
      <p style={{ fontSize: "1.125rem", opacity: 0.8 }}>
        Your new Next.js app inside the monorepo.
      </p>
    </main>
  );
}
