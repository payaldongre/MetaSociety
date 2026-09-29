// import { useState } from "react";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Textarea } from "@/components/ui/textarea";
// import { mockPolicySuggestions } from "@/lib/mockData";
// import { Bot, Send, Save, FlaskConical, Shield, AlertTriangle, Users } from "lucide-react";
// import { toast } from "sonner";

// interface Message {
//   role: "user" | "assistant";
//   content: string;
//   suggestions?: typeof mockPolicySuggestions;
// }

// export default function AIAdvisor() {
//   const [messages, setMessages] = useState<Message[]>([]);
//   const [input, setInput] = useState("");
//   const [constraints, setConstraints] = useState("");
//   const [loading, setLoading] = useState(false);

//   const handleSend = async () => {
//     if (!input.trim()) return;
//     const userMsg: Message = { role: "user", content: input + (constraints ? `\n\nConstraints: ${constraints}` : "") };
//     setMessages((prev) => [...prev, userMsg]);
//     setInput("");
//     setConstraints("");
//     setLoading(true);

//     // Simulate AI response
//     setTimeout(() => {
//       const assistantMsg: Message = {
//         role: "assistant",
//         content: `Based on your goal "${input.trim()}", here are my policy recommendations:`,
//         suggestions: mockPolicySuggestions,
//       };
//       setMessages((prev) => [...prev, assistantMsg]);
//       setLoading(false);
//     }, 1500);
//   };

//   return (
//     <div className="space-y-6 max-w-4xl mx-auto">
//       <div className="animate-fade-up">
//         <h1 className="text-2xl font-bold text-foreground">AI Policy Advisor</h1>
//         <p className="text-muted-foreground text-sm mt-1">Describe your policy goals and get AI-powered suggestions with impact analysis.</p>
//       </div>

//       {/* Chat area */}
//       <div className="animate-fade-up stagger-1 rounded-lg border bg-card min-h-[400px] max-h-[600px] overflow-y-auto p-4 space-y-4">
//         {messages.length === 0 && (
//           <div className="flex flex-col items-center justify-center h-64 text-center">
//             <Bot className="h-12 w-12 text-muted-foreground/30 mb-3" />
//             <p className="text-muted-foreground text-sm max-w-sm">
//               Describe your policy goal — for example, "Reduce unemployment without increasing inflation" or "Make housing more affordable."
//             </p>
//           </div>
//         )}

//         {messages.map((msg, i) => (
//           <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
//             <div className={`max-w-[85%] rounded-lg px-4 py-3 ${
//               msg.role === "user"
//                 ? "bg-primary text-primary-foreground"
//                 : "bg-secondary text-secondary-foreground"
//             }`}>
//               <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
//               {msg.suggestions && (
//                 <div className="mt-4 space-y-3">
//                   {msg.suggestions.map((s, j) => (
//                     <div key={j} className="rounded-md border bg-card p-4 text-card-foreground">
//                       <h4 className="font-semibold text-sm">{j + 1}. {s.name}</h4>
//                       <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
//                       <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 text-xs">
//                         <div className="flex items-start gap-1.5">
//                           <Shield className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
//                           <span><strong>Benefits:</strong> {s.benefits}</span>
//                         </div>
//                         <div className="flex items-start gap-1.5">
//                           <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
//                           <span><strong>Risks:</strong> {s.risks}</span>
//                         </div>
//                         <div className="flex items-start gap-1.5">
//                           <Users className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
//                           <span><strong>Affected:</strong> {s.affected}</span>
//                         </div>
//                       </div>
//                       <div className="flex gap-2 mt-3">
//                         <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.success(`"${s.name}" saved`)}>
//                           <Save className="h-3 w-3 mr-1" />Save
//                         </Button>
//                         <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.info(`"${s.name}" sent to Simulation Lab`)}>
//                           <FlaskConical className="h-3 w-3 mr-1" />Simulate
//                         </Button>
//                       </div>
//                     </div>
//                   ))}
//                 </div>
//               )}
//             </div>
//           </div>
//         ))}

//         {loading && (
//           <div className="flex justify-start">
//             <div className="bg-secondary rounded-lg px-4 py-3 flex items-center gap-2">
//               <div className="flex gap-1">
//                 <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
//                 <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
//                 <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
//               </div>
//               <span className="text-xs text-muted-foreground">Analyzing policies...</span>
//             </div>
//           </div>
//         )}
//       </div>

//       {/* Input area */}
//       <div className="animate-fade-up stagger-2 space-y-2">
//         <div className="flex gap-2">
//           <Input
//             placeholder="Describe your policy goal..."
//             value={input}
//             onChange={(e) => setInput(e.target.value)}
//             onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
//             className="flex-1"
//           />
//           <Button onClick={handleSend} disabled={loading || !input.trim()}>
//             <Send className="h-4 w-4" />
//           </Button>
//         </div>
//         <Textarea
//           placeholder="Optional: Add constraints (e.g., budget limit $10M, avoid tax increases, protect seniors)"
//           value={constraints}
//           onChange={(e) => setConstraints(e.target.value)}
//           rows={2}
//           className="text-sm resize-none"
//         />
//       </div>
//     </div>
//   );
// }

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Send, Save, FlaskConical, Shield, AlertTriangle, Users } from "lucide-react";
import { toast } from "sonner";

// CHANGED: real shape returned by the ai-policy-advisor-engine's /policy endpoint.
// benefits/risks/affected come back as string ARRAYS (see sample_outputs/*.json),
// not single strings like the old mockPolicySuggestions had.
interface PolicySuggestion {
  name: string;
  description: string;
  benefits: string[];
  risks: string[];
  affected: string[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  suggestions?: PolicySuggestion[];
}

// CHANGED: backend base URL, configurable via .env (VITE_API_URL).
// Falls back to localhost:8000 for local dev if the env var isn't set.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export default function AIAdvisor() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [constraints, setConstraints] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;
    const goal = input.trim() + (constraints ? `\n\nConstraints: ${constraints}` : "");
    const userMsg: Message = { role: "user", content: goal };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setConstraints("");
    setLoading(true);

    // CHANGED: replaced the fake setTimeout()+mockPolicySuggestions with a real
    // call to the FastAPI /policy endpoint (ai-policy-advisor-engine).
    try {
      const res = await fetch(`${API_URL}/policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: goal }),
      });

      if (!res.ok) {
        throw new Error(`Policy engine responded with ${res.status}`);
      }

      const data: {
        response: PolicySuggestion[];
        chart_extracts: unknown;
        warnings: string[];
      } = await res.json();

      if (data.warnings?.length) {
        // Non-fatal issues from the pipeline (e.g. a dataset failed to load) —
        // surface them without blocking the response.
        data.warnings.forEach((w) => toast.warning(w));
      }

      const assistantMsg: Message = {
        role: "assistant",
        content: `Based on your goal "${input.trim()}", here are my policy recommendations:`,
        suggestions: data.response,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      toast.error(
        "Couldn't reach the policy engine. Is the backend running at " + API_URL + "?"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground">AI Policy Advisor</h1>
        <p className="text-muted-foreground text-sm mt-1">Describe your policy goals and get AI-powered suggestions with impact analysis.</p>
      </div>

      {/* Chat area */}
      <div className="animate-fade-up stagger-1 rounded-lg border bg-card min-h-[400px] max-h-[600px] overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Bot className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm max-w-sm">
              Describe your policy goal — for example, "Reduce unemployment without increasing inflation" or "Make housing more affordable."
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-4 py-3 ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground"
            }`}>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              {msg.suggestions && (
                <div className="mt-4 space-y-3">
                  {msg.suggestions.map((s, j) => (
                    <div key={j} className="rounded-md border bg-card p-4 text-card-foreground">
                      <h4 className="font-semibold text-sm">{j + 1}. {s.name}</h4>
                      <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                      {/* CHANGED: benefits/risks/affected are now arrays, rendered as bullet lists
                          instead of a single joined string. */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 text-xs">
                        <div className="flex items-start gap-1.5">
                          <Shield className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                          <div>
                            <strong>Benefits:</strong>
                            <ul className="list-disc list-inside">
                              {s.benefits.map((b, k) => <li key={k}>{b}</li>)}
                            </ul>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                          <div>
                            <strong>Risks:</strong>
                            <ul className="list-disc list-inside">
                              {s.risks.map((r, k) => <li key={k}>{r}</li>)}
                            </ul>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <Users className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                          <div>
                            <strong>Affected:</strong>
                            <ul className="list-disc list-inside">
                              {s.affected.map((a, k) => <li key={k}>{a}</li>)}
                            </ul>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.success(`"${s.name}" saved`)}>
                          <Save className="h-3 w-3 mr-1" />Save
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.info(`"${s.name}" sent to Simulation Lab`)}>
                          <FlaskConical className="h-3 w-3 mr-1" />Simulate
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-secondary rounded-lg px-4 py-3 flex items-center gap-2">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-xs text-muted-foreground">Analyzing policies...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="animate-fade-up stagger-2 space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="Describe your policy goal..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <Textarea
          placeholder="Optional: Add constraints (e.g., budget limit $10M, avoid tax increases, protect seniors)"
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          rows={2}
          className="text-sm resize-none"
        />
      </div>
    </div>
  );
}
