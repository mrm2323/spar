import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

function createMissingEnvProxy() {
	const fail = () => {
		throw new Error(
			'Supabase env is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel Project Settings.'
		);
	};

	// Return a chainable object so method access does not crash at import time.
	const chain = {
		from: fail,
		rpc: fail,
		auth: {
			getUser: fail,
			signInWithPassword: fail,
			signOut: fail,
		},
	};

	return chain;
}

export const supabase =
	supabaseUrl && supabaseAnonKey
		? createClient(supabaseUrl, supabaseAnonKey)
		: createMissingEnvProxy();
