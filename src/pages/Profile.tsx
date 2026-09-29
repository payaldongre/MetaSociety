import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { User, LogOut } from "lucide-react";

export default function Profile() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState({
    fullName: user?.fullName || "",
    organization: user?.organization || "",
    role: user?.role || "",
    country: user?.country || "",
  });

  const save = () => {
    // Update localStorage
    const updated = { ...user!, ...profile };
    localStorage.setItem("meta_society_user", JSON.stringify(updated));
    toast.success("Profile updated");
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
      </div>
      <div className="animate-fade-up stagger-1 rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-card-foreground">{user?.fullName || "User"}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <div>
          <Label className="text-xs">Full Name</Label>
          <Input className="mt-1" value={profile.fullName} onChange={(e) => setProfile(p => ({ ...p, fullName: e.target.value }))} />
        </div>
        <div>
          <Label className="text-xs">Organization</Label>
          <Input className="mt-1" value={profile.organization} onChange={(e) => setProfile(p => ({ ...p, organization: e.target.value }))} />
        </div>
        <div>
          <Label className="text-xs">Role</Label>
          <Input className="mt-1" value={profile.role} disabled />
        </div>
        <div>
          <Label className="text-xs">Country/Region</Label>
          <Input className="mt-1" value={profile.country} onChange={(e) => setProfile(p => ({ ...p, country: e.target.value }))} />
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={save}>Save Changes</Button>
          <Button variant="outline" onClick={signOut}><LogOut className="h-4 w-4 mr-1.5" />Sign Out</Button>
        </div>
      </div>
    </div>
  );
}
