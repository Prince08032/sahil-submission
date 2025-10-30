// apps/web/src/App.tsx
import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Upload,
  Copy,
  Trash2,
  Edit2,
  X,
  AlertCircle,
  Loader2,
  Clock,
  WifiOff,
} from "lucide-react";


type AssetStatus =
  | "draft"
  | "uploading"
  | "verifying"
  | "ready"
  | "corrupt"
  | "error"
  | "cancelled";

interface Asset {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string | null;
  status: AssetStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface UploadTicket {
  assetId: string;
  storagePath: string;
  uploadUrl: string;
  expiresAt: string;
  nonce?: string;
  version: number;
}

interface UploadState {
  assetId: string;
  file: File;
  status: AssetStatus;
  progress: number;
  error?: string;
  ticket?: UploadTicket;
  abortController?: AbortController;
  queuedFinalize?: boolean;
  clientSha256?: string;
}

interface DownloadLinkState {
  url: string;
  expiresAt: string;
  secondsRemaining: number;
}


const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// === GraphQL helper with enhanced logging ===
async function graphqlRequest(query: string, variables?: unknown) {

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  
  
  if (!session) {
    console.error('No active session found');
    throw new Error('No active session. Please login again.');
  }
  
  if (sessionError) {
    console.error('Session error:', sessionError);
    throw new Error('Session error: ' + sessionError.message);
  }

  console.log('Session found for user:', session.user.id);
  console.log('Token preview:', session.access_token.substring(0, 30) + '...');


  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:4000/graphql";
  console.log('Sending request to:', apiUrl);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    console.error('Failed to parse response:', text);
    throw new Error(`Unexpected response from GraphQL server: ${text}`);
  }

  // Handle errors
  if (result.errors && result.errors.length) {
    const first = result.errors[0];

  
    if (first.extensions?.code === 'UNAUTHENTICATED') {
     
      // Try to refresh session
      const { data: refreshData } = await supabase.auth.refreshSession();
      if (refreshData.session) {
  
        throw new Error('Session expired. Please retry your action.');
      } else {
        console.error(' Cannot refresh session - please login again');
        await supabase.auth.signOut();
        throw new Error('Session expired. Please login again.');
      }
    }
    
    const msg = first.message || "GraphQL error";
    throw new Error(`${msg} | details: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

// === SHA256 helper ===
async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// === App ===
export default function App(): JSX.Element {
  const [user, setUser] = useState<any>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploads, setUploads] = useState<Map<string, UploadState>>(new Map());
  const [downloadLinks, setDownloadLinks] = useState<Map<string, DownloadLinkState>>(new Map());
  const [offline, setOffline] = useState<boolean>(() => !navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Auth init
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('Initial session check:', session ? 'Logged in' : 'Not logged in');
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      setUser(session?.user ?? null);
      
      // Clear assets when logging out
      if (!session) {
        setAssets([]);
        setDownloadLinks(new Map());
      }
    });

    window.addEventListener("online", () => setOffline(false));
    window.addEventListener("offline", () => setOffline(true));

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("online", () => setOffline(false));
      window.removeEventListener("offline", () => setOffline(true));
    };
  }, []);

  // Countdown timer for download links
  useEffect(() => {
    const interval = setInterval(() => {
      setDownloadLinks((prev) => {
        const next = new Map(prev);
        let changed = false;
        next.forEach((link, assetId) => {
          const expiresAt = new Date(link.expiresAt).getTime();
          const secondsRemaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
          if (secondsRemaining !== link.secondsRemaining) {
            changed = true;
            if (secondsRemaining === 0) next.delete(assetId);
            else link.secondsRemaining = secondsRemaining;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load assets
  const loadAssets = useCallback(async () => {
    if (!user) {
      console.log('No user, skipping asset load');
      setAssets([]);
      return;
    }
    
    console.log('Loading assets for user:', user.id);
    
    try {
      const data = await graphqlRequest(`
        query {
          myAssets(first: 50) {
            edges { node {
              id filename mime size sha256 status version createdAt updatedAt
            } }
          }
        }
      `);
      const edges = data?.myAssets?.edges ?? [];
      console.log('Loaded assets:', edges.length);
      setAssets(edges.map((e: any) => e.node));
    } catch (err) {
      console.error("Failed to load assets:", err);
      alert("Failed to load assets: " + (err instanceof Error ? err.message : String(err)));
      setAssets([]);
    }
  }, [user]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // Auth handlers
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (authMode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        console.log('Sign in successful:', data.user?.email);
      } else {
      
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
       
        alert("Sign up successful — check your email (if confirmation enabled).");
      }
    } catch (err: any) {
  
      alert(err.message || String(err));
    }
  };

  const handleSignOut = async () => {
  
    await supabase.auth.signOut();
    setAssets([]);
    setDownloadLinks(new Map());

  };

  // Retry queued finalizes when connection returns
  useEffect(() => {
    if (!offline) {
      uploads.forEach(async (u, uploadId) => {
        if (u.queuedFinalize && u.ticket && u.clientSha256) {
          try {
            setUploads((prev) => {
              const next = new Map(prev);
              const cur = next.get(uploadId);
              if (cur) cur.status = "verifying";
              return next;
            });
            await graphqlRequest(
              `
                mutation($assetId: ID!, $clientSha256: String!, $version: Int!) {
                  finalizeUpload(assetId: $assetId, clientSha256: $clientSha256, version: $version) {
                    id status
                  }
                }
              `,
              { assetId: u.ticket.assetId, clientSha256: u.clientSha256, version: u.ticket.version ?? 1 }
            );

            setUploads((prev) => {
              const next = new Map(prev);
              const cur = next.get(uploadId);
              if (cur) {
                cur.status = "ready";
                cur.queuedFinalize = false;
              }
              return next;
            });
            loadAssets();
            setTimeout(() => {
              setUploads((prev) => {
                const next = new Map(prev);
                next.delete(uploadId);
                return next;
              });
            }, 1500);
          } catch (err: any) {
            console.error("Queued finalize failed:", err);
            setUploads((prev) => {
              const next = new Map(prev);
              const cur = next.get(uploadId);
              if (cur) {
                cur.status = "error";
                cur.error = err.message || String(err);
              }
              return next;
            });
          }
        }
      });
    }
  }, [offline, uploads, loadAssets]);

  // File handling
  const handleFiles = async (files: FileList) => {
    for (const f of Array.from(files)) await startUpload(f);
  };

  const startUpload = async (file: File) => {
    const uploadId = crypto.randomUUID();
    setUploads((prev) => {
      const next = new Map(prev);
      next.set(uploadId, {
        assetId: "",
        file,
        status: "draft",
        progress: 0,
      });
      return next;
    });

    try {
      const ticketData = await graphqlRequest(
        `
        mutation($filename: String!, $mime: String!, $size: Int!) {
          createUploadUrl(filename: $filename, mime: $mime, size: $size) {
            assetId storagePath uploadUrl expiresAt version nonce
          }
        }
      `,
        { filename: file.name, mime: file.type, size: file.size }
      );

      const ticket: UploadTicket = ticketData.createUploadUrl;

      const abortController = new AbortController();
      setUploads((prev) => {
        const next = new Map(prev);
        const cur = next.get(uploadId)!;
        cur.ticket = ticket;
        cur.assetId = ticket.assetId;
        cur.abortController = abortController;
        cur.status = "uploading";
        return next;
      });

      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const p = Math.round((e.loaded / e.total) * 100);
          setUploads((prev) => {
            const next = new Map(prev);
            const cur = next.get(uploadId);
            if (cur) cur.progress = p;
            return next;
          });
        }
      });

      if (devMode && Math.random() < 0.15) throw new Error("Simulated network error (dev mode)");

      const token = (await supabase.auth.getSession()).data.session?.access_token;

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed HTTP ${xhr.status}: ${xhr.responseText || xhr.statusText}`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.onabort = () => reject(new Error("Upload cancelled"));
        abortController.signal.addEventListener("abort", () => xhr.abort());

        xhr.open("PUT", ticket.uploadUrl);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.send(file);
      });

      setUploads((prev) => {
        const next = new Map(prev);
        const cur = next.get(uploadId)!;
        cur.status = "verifying";
        cur.progress = 100;
        return next;
      });

      const clientSha256 = await computeSHA256(file);

      if (offline) {
        setUploads((prev) => {
          const next = new Map(prev);
          const cur = next.get(uploadId)!;
          cur.queuedFinalize = true;
          cur.clientSha256 = clientSha256;
          cur.status = "verifying";
          return next;
        });
        return;
      }

      await graphqlRequest(
        `
        mutation($assetId: ID!, $clientSha256: String!, $version: Int!) {
          finalizeUpload(assetId: $assetId, clientSha256: $clientSha256, version: $version) {
            id filename status version
          }
        }
      `,
        {
          assetId: ticket.assetId,
          clientSha256,
          version: ticket.version ?? 1,
        }
      );

      setUploads((prev) => {
        const next = new Map(prev);
        const cur = next.get(uploadId)!;
        cur.status = "ready";
        return next;
      });

      await loadAssets();

      setTimeout(() => {
        setUploads((prev) => {
          const next = new Map(prev);
          next.delete(uploadId);
          return next;
        });
      }, 2000);
    } catch (err: any) {
      console.error("Upload failed:", err);
      setUploads((prev) => {
        const next = new Map(prev);
        const cur = next.get(uploadId);
        if (cur) {
          cur.status = err.message === "Upload cancelled" ? "cancelled" : "error";
          cur.error = err.message || String(err);
        }
        return next;
      });
    }
  };

  const cancelUpload = (uploadId: string) => {
    const state = uploads.get(uploadId);
    if (state?.abortController) state.abortController.abort();
    setUploads((prev) => {
      const next = new Map(prev);
      const cur = next.get(uploadId);
      if (cur) cur.status = "cancelled";
      setTimeout(() => {
        setUploads((p) => { const n = new Map(p); n.delete(uploadId); return n; });
      }, 1200);
      return next;
    });
  };

  const retryUpload = (uploadId: string) => {
    const state = uploads.get(uploadId);
    if (!state) return;
    startUpload(state.file);
    setUploads((prev) => {
      const next = new Map(prev);
      next.delete(uploadId);
      return next;
    });
  };

  const getDownloadLink = async (assetId: string) => {
    try {
   
      
      const data = await graphqlRequest(
        `
        query($assetId: ID!) {
          getDownloadUrl(assetId: $assetId) {
            url expiresAt
          }
        }
      `,
        { assetId }
      );
      
      const link = data.getDownloadUrl;
 
      
      await navigator.clipboard.writeText(link.url);
      const expiresAt = new Date(link.expiresAt).getTime();
      const secondsRemaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      
      setDownloadLinks((prev) => {
        const next = new Map(prev);
        next.set(assetId, { url: link.url, expiresAt: link.expiresAt, secondsRemaining });
        return next;
      });
      
      alert(`Link copied. Expires in ${secondsRemaining}s.`);
    } catch (err: any) {

      alert("Failed to get download link: " + (err.message || String(err)));
    }
  };

  const renameAsset = async (asset: Asset) => {
    const newName = prompt("New filename:", asset.filename);
    if (!newName || newName === asset.filename) return;
    try {
      await graphqlRequest(
        `
        mutation($assetId: ID!, $filename: String!, $version: Int!) {
          renameAsset(assetId: $assetId, filename: $filename, version: $version) {
            id filename version
          }
        }
      `,
        { assetId: asset.id, filename: newName, version: asset.version }
      );
      loadAssets();
      alert("Renamed");
    } catch (err: any) {
      if ((err.message || "").toLowerCase().includes("conflict")) {
        alert("Version conflict. Reloading...");
        loadAssets();
      } else {
        alert("Rename failed: " + (err.message || String(err)));
      }
    }
  };

  const deleteAsset = async (asset: Asset) => {
    if (!confirm(`Delete "${asset.filename}"?`)) return;
    try {
      await graphqlRequest(
        `
        mutation($assetId: ID!, $version: Int!) {
          deleteAsset(assetId: $assetId, version: $version)
        }
      `,
        { assetId: asset.id, version: asset.version }
      );
      loadAssets();
      alert("Deleted");
    } catch (err: any) {
      alert("Delete failed: " + (err.message || String(err)));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-md w-96">
          <h1 className="text-2xl font-bold mb-6">Secure Media Vault</h1>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setAuthMode("signin")}
              className={`flex-1 py-2 rounded ${authMode === "signin" ? "bg-blue-600 text-white" : "bg-gray-200"}`}
            >
              Sign In
            </button>
            <button
              onClick={() => setAuthMode("signup")}
              className={`flex-1 py-2 rounded ${authMode === "signup" ? "bg-blue-600 text-white" : "bg-gray-200"}`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2 border rounded" required />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2 border rounded" required />
            <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
              {authMode === "signin" ? "Sign In" : "Sign Up"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Secure Media Vault</h1>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} />
              Dev Mode (15% fail)
            </label>
            {offline && <div className="text-red-600 flex items-center gap-1"><WifiOff size={14}/> Offline</div>}
            <span className="text-sm text-gray-600">{user.email}</span>
            <button onClick={handleSignOut} className="px-4 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300">Sign Out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center mb-8 transition-colors ${isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"}`}
          onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        >
          <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <p className="text-lg mb-2">Drag and drop files here</p>
          <p className="text-sm text-gray-500 mb-4">or</p>
          <label className="inline-block px-6 py-3 bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700">
            Choose Files
            <input type="file" multiple className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} accept="image/jpeg,image/png,image/webp,application/pdf" />
          </label>
          <p className="text-xs text-gray-500 mt-4">Supported: JPEG, PNG, WebP, PDF (max 50MB)</p>
        </div>

        {uploads.size > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-4">Uploading ({uploads.size})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from(uploads.entries()).map(([id, upload]) => (
                <UploadCard key={id} upload={upload} onCancel={() => cancelUpload(id)} onRetry={() => retryUpload(id)} />
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-lg font-semibold mb-4">My Assets ({assets.length})</h2>
          {assets.length === 0 ? (
            <p className="text-gray-500 text-center py-12">No assets yet. Upload your first file!</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {assets.map((asset) => (
                <AssetCard key={asset.id} asset={asset} downloadLink={downloadLinks.get(asset.id)} onDownload={getDownloadLink} onRename={renameAsset} onDelete={deleteAsset} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// UploadCard component
function UploadCard({ upload, onCancel, onRetry }: any) {
  const statusColors: Record<AssetStatus, string> = {
    draft: "bg-gray-100 text-gray-700",
    uploading: "bg-blue-100 text-blue-700",
    verifying: "bg-yellow-100 text-yellow-700",
    ready: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
    corrupt: "bg-red-100 text-red-700",
    cancelled: "bg-gray-200 text-gray-500",
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{upload.file.name}</p>
          <p className="text-sm text-gray-500">{(upload.file.size / 1024).toFixed(1)} KB</p>
        </div>
        {upload.status === "uploading" && (
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        )}
      </div>

      <div className={`inline-block px-3 py-1 rounded text-xs font-medium mb-2 ${statusColors[upload.status]}`}>
        {upload.status === "uploading" && `Uploading ${upload.progress}%`}
        {upload.status === "verifying" && "Verifying..."}
        {upload.status === "ready" && "Complete!"}
        {upload.status === "error" && "Failed"}
        {upload.status === "draft" && "Preparing..."}
        {upload.status === "cancelled" && "Cancelled"}
      </div>

      {upload.status === "uploading" && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${upload.progress}%` }} />
        </div>
      )}

      {upload.status === "error" && (
        <div className="mt-2">
          <p className="text-sm text-red-600 mb-2">{upload.error}</p>
          <button onClick={onRetry} className="text-sm text-blue-600 hover:underline">Retry Upload</button>
        </div>
      )}
    </div>
  );
}

// AssetCard component
function AssetCard({ asset, downloadLink, onDownload, onRename, onDelete }: any) {
  const statusColors: Record<string, string> = {
    ready: "bg-green-100 text-green-700",
    corrupt: "bg-red-100 text-red-700",
    uploading: "bg-blue-100 text-blue-700",
    verifying: "bg-yellow-100 text-yellow-700",
    draft: "bg-gray-100 text-gray-700",
    error: "bg-red-100 text-red-700",
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
      <div className="p-4">
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate" title={asset.filename}>{asset.filename}</p>
            <p className="text-sm text-gray-500">{formatFileSize(asset.size)} • {formatDate(asset.createdAt)}</p>
          </div>
          <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${statusColors[asset.status]}`}>{asset.status}</span>
        </div>

        {asset.sha256 && <p className="text-xs text-gray-400 font-mono truncate mb-3" title={asset.sha256}>SHA-256: {asset.sha256.substring(0, 16)}...</p>}

        {downloadLink && (
          <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded flex items-center gap-2">
            <Clock size={14} className="text-green-600" />
            <span className="text-xs text-green-700 font-medium">Link expires in {downloadLink.secondsRemaining}s</span>
          </div>
        )}

        {asset.status === "ready" && (
          <div className="flex gap-2 mt-4">
            <button onClick={() => onDownload(asset.id)} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700" title="Copy download link">
              <Copy size={16} /> Copy Link
            </button>
            <button onClick={() => onRename(asset)} className="px-3 py-2 bg-gray-100 rounded hover:bg-gray-200" title="Rename"><Edit2 size={16} /></button>
            <button onClick={() => onDelete(asset)} className="px-3 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200" title="Delete"><Trash2 size={16} /></button>
          </div>
        )}

        {asset.status === "corrupt" && (
          <div className="mt-2 p-2 bg-red-50 rounded">
            <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> Integrity check failed</p>
          </div>
        )}

        {(asset.status === "uploading" || asset.status === "verifying") && (
          <div className="mt-2 p-2 bg-blue-50 rounded">
            <p className="text-sm text-blue-600 flex items-center gap-1"><Loader2 size={14} className="animate-spin" /> Processing...</p>
          </div>
        )}
      </div>
    </div>
  );
}