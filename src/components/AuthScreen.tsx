import { useState } from 'react';
import { useAuth } from '../lib/auth';

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue.';
      if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setError('Email ou mot de passe incorrect.');
      } else if (msg.includes('email-already-in-use')) {
        setError('Cet email est déjà utilisé.');
      } else if (msg.includes('weak-password')) {
        setError('Mot de passe trop court (6 caractères minimum).');
      } else if (msg.includes('invalid-email')) {
        setError('Adresse email invalide.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen w-full bg-[#FDFCFA] dark:bg-[#0D0D0C]">
      <div className="w-full max-w-sm px-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-12">
          <div className="w-8 h-8 rounded-full bg-black dark:bg-white flex items-center justify-center mb-6">
            <div className="w-3 h-3 bg-white dark:bg-black rotate-45" />
          </div>
          <span className="text-[10px] tracking-[0.4em] font-semibold text-[#8C8C8C] uppercase">
            S0CR4T3
          </span>
        </div>

        {/* Mode toggle */}
        <div className="flex border-b border-[#E5E2DD] dark:border-[#2D2D29] mb-8">
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); }}
            className={`flex-1 pb-3 text-[10px] tracking-[0.2em] uppercase font-semibold transition-colors border-b-2 -mb-px ${
              mode === 'login'
                ? 'border-black dark:border-white text-black dark:text-white'
                : 'border-transparent text-[#CBC7C0] hover:text-[#8C8C8C]'
            }`}
          >
            Connexion
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError(''); }}
            className={`flex-1 pb-3 text-[10px] tracking-[0.2em] uppercase font-semibold transition-colors border-b-2 -mb-px ${
              mode === 'register'
                ? 'border-black dark:border-white text-black dark:text-white'
                : 'border-transparent text-[#CBC7C0] hover:text-[#8C8C8C]'
            }`}
          >
            Créer un compte
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] tracking-[0.25em] uppercase text-[#8C8C8C] font-semibold">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="bg-transparent border-b border-[#E5E2DD] dark:border-[#2D2D29] pb-2 text-sm font-light text-[#1A1A1A] dark:text-[#ECEAE4] outline-none placeholder:text-[#CBC7C0] focus:border-black dark:focus:border-white transition-colors"
              placeholder="votre@email.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] tracking-[0.25em] uppercase text-[#8C8C8C] font-semibold">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="bg-transparent border-b border-[#E5E2DD] dark:border-[#2D2D29] pb-2 text-sm font-light text-[#1A1A1A] dark:text-[#ECEAE4] outline-none placeholder:text-[#CBC7C0] focus:border-black dark:focus:border-white transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-[11px] text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full flex items-center justify-between px-0 py-3 text-[10px] tracking-[0.2em] uppercase font-bold text-[#1A1A1A] dark:text-[#ECEAE4] disabled:opacity-30 group transition-opacity"
          >
            <span>{loading ? 'Chargement...' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}</span>
            <div className="w-12 h-[1px] bg-current group-hover:w-16 transition-all" />
          </button>
        </form>
      </div>
    </div>
  );
}
