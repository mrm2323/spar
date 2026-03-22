-- Add daily cap reset tracking to users table
ALTER TABLE users ADD COLUMN daily_cap_reset_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Create index for faster queries
CREATE INDEX idx_users_daily_cap_reset ON users(daily_cap_reset_at);
