import React, { useState, useEffect, useCallback } from 'react';
import { 
  AlertTriangle, Shield, Users, TrendingUp, Clock, 
  Eye, CheckCircle, XCircle, RefreshCw, Download
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// ============================================
// KABIR SAFETY MONITORING DASHBOARD
// For developer/admin use only
// ============================================

export function AdminDashboard() {
  const hasSupabaseEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL
  ) && Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  );

  const [stats, setStats] = useState(null);
  const [recentCrisis, setRecentCrisis] = useState([]);
  const [recentFilters, setRecentFilters] = useState([]);
  const [dependencyFlags, setDependencyFlags] = useState([]);
  const [csat, setCsat] = useState(null);
  const [csatError, setCsatError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24h');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch dashboard data
  const fetchData = useCallback(async () => {
    if (!hasSupabaseEnv) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    
    // Calculate time range
    const now = new Date();
    let startTime;
    switch (timeRange) {
      case '1h': startTime = new Date(now - 60 * 60 * 1000); break;
      case '24h': startTime = new Date(now - 24 * 60 * 60 * 1000); break;
      case '7d': startTime = new Date(now - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': startTime = new Date(now - 30 * 24 * 60 * 60 * 1000); break;
      default: startTime = new Date(now - 24 * 60 * 60 * 1000);
    }

    try {
      const adminPassword = sessionStorage.getItem('kabir_admin_password') || '';

      // Fetch crisis stats
      const { data: crisisData } = await supabase
        .from('crisis_logs')
        .select('*')
        .gte('created_at', startTime.toISOString())
        .order('created_at', { ascending: false });

      // Fetch content filter logs
      const { data: filterData } = await supabase
        .from('content_filter_logs')
        .select('*')
        .gte('created_at', startTime.toISOString())
        .order('created_at', { ascending: false });

      // Fetch dependency flags
      const { data: flagsData } = await supabase
        .from('dependency_flags')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      // Fetch today's summary
      const today = new Date().toISOString().split('T')[0];
      const { data: summaryData } = await supabase
        .from('safety_daily_summary')
        .select('*')
        .eq('summary_date', today)
        .single();

      const csatRes = await fetch(`/api/admin/csat?range=${timeRange}`, {
        headers: {
          'x-admin-password': adminPassword,
        },
      });
      const csatData = await csatRes.json().catch(() => ({}));
      if (!csatRes.ok) {
        setCsatError(csatData?.error || 'Could not load CSAT metrics');
        setCsat(null);
      } else {
        setCsatError('');
        setCsat(csatData);
      }

      // Calculate stats
      const crisisStats = {
        total: crisisData?.length || 0,
        critical: crisisData?.filter(c => c.detection_level === 'CRITICAL').length || 0,
        high: crisisData?.filter(c => c.detection_level === 'HIGH').length || 0,
        medium: crisisData?.filter(c => c.detection_level === 'MEDIUM').length || 0,
        escalated: crisisData?.filter(c => c.escalated_to_human).length || 0,
      };

      const filterStats = {
        total: filterData?.length || 0,
        blocked: filterData?.filter(f => f.action_taken === 'BLOCKED').length || 0,
        modified: filterData?.filter(f => f.action_taken === 'MODIFIED').length || 0,
        jailbreaks: filterData?.filter(f => f.trigger_type === 'JAILBREAK_ATTEMPT').length || 0,
      };

      setStats({ crisis: crisisStats, filter: filterStats, summary: summaryData });
      setRecentCrisis(crisisData?.slice(0, 10) || []);
      setRecentFilters(filterData?.slice(0, 10) || []);
      setDependencyFlags(flagsData || []);

    } catch (error) {
      console.error('Dashboard fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [hasSupabaseEnv, timeRange]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchData();
    
    if (autoRefresh) {
      const interval = setInterval(fetchData, 30000); // 30 seconds
      return () => clearInterval(interval);
    }
  }, [fetchData, autoRefresh]);

  // Stat card component
  const StatCard = ({ title, value, subtext, icon: Icon, color = 'blue', urgent = false }) => (
    <div className={`bg-white dark:bg-gray-800 rounded-xl p-4 border ${
      urgent ? 'border-red-200 dark:border-red-800' : 'border-gray-100 dark:border-gray-700'
    } ${urgent ? 'animate-pulse' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${
            urgent ? 'text-red-500' : 'text-gray-900 dark:text-gray-100'
          }`}>
            {value}
          </p>
          {subtext && (
            <p className="text-xs text-gray-400 mt-1">{subtext}</p>
          )}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          urgent ? 'bg-red-100 dark:bg-red-900/50' : `bg-${color}-100 dark:bg-${color}-900/50`
        }`}>
          <Icon className={`w-5 h-5 ${
            urgent ? 'text-red-500' : `text-${color}-500`
          }`} />
        </div>
      </div>
    </div>
  );

  // Crisis level badge
  const CrisisLevelBadge = ({ level }) => {
    const colors = {
      CRITICAL: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
      HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
      MEDIUM: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200',
      LOW: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[level] || colors.LOW}`}>
        {level}
      </span>
    );
  };

  // Export data
  const handleExport = () => {
    const data = {
      stats,
      csat,
      recentCrisis,
      recentFilters,
      dependencyFlags,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kabir-safety-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  if (isLoading && !stats) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!hasSupabaseEnv) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Missing Supabase Configuration</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your Vercel project settings,
            then redeploy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Kabir Safety Dashboard
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              Monitor safety metrics and review flagged interactions
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Time range selector */}
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm"
            >
              <option value="1h">Last hour</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
            
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm ${
                autoRefresh 
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' 
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? 'Auto' : 'Manual'}
            </button>
            
            {/* Manual refresh */}
            <button
              onClick={fetchData}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            >
              <RefreshCw className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
            
            {/* Export */}
            <button
              onClick={handleExport}
              className="px-3 py-2 bg-blue-500 text-white rounded-lg flex items-center gap-2 text-sm hover:bg-blue-600"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>

        {/* Urgent Alert Banner */}
        {stats?.crisis?.critical > 0 && (
          <div className="bg-red-500 text-white p-4 rounded-xl mb-6 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6" />
            <div>
              <p className="font-semibold">
                {stats.crisis.critical} Critical Crisis Detection{stats.crisis.critical > 1 ? 's' : ''}
              </p>
              <p className="text-sm opacity-90">
                Immediate review required. Check recent crisis logs below.
              </p>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="Crisis Detections"
            value={stats?.crisis?.total || 0}
            subtext={`${stats?.crisis?.critical || 0} critical, ${stats?.crisis?.high || 0} high`}
            icon={AlertTriangle}
            color="amber"
            urgent={stats?.crisis?.critical > 0}
          />
          <StatCard
            title="Content Filtered"
            value={stats?.filter?.total || 0}
            subtext={`${stats?.filter?.blocked || 0} blocked, ${stats?.filter?.modified || 0} modified`}
            icon={Shield}
            color="blue"
          />
          <StatCard
            title="Dependency Flags"
            value={dependencyFlags.length}
            subtext="Active unresolved flags"
            icon={Users}
            color="purple"
            urgent={dependencyFlags.length > 5}
          />
          <StatCard
            title="Jailbreak Attempts"
            value={stats?.filter?.jailbreaks || 0}
            subtext="Blocked manipulation attempts"
            icon={XCircle}
            color="red"
          />
        </div>

        {/* CSAT Monitor */}
        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Call CSAT Monitor
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                End-of-call rating, recommendation score, response rate, and NPS buckets.
              </p>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">Range: {timeRange}</span>
          </div>

          {csatError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">
              {csatError}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatCard
              title="Avg Star Rating"
              value={csat?.metrics?.avg_call_rating ?? '-'}
              subtext="Out of 5"
              icon={TrendingUp}
              color="emerald"
            />
            <StatCard
              title="Avg Recommend"
              value={csat?.metrics?.avg_recommend_score ?? '-'}
              subtext="Out of 10"
              icon={TrendingUp}
              color="blue"
            />
            <StatCard
              title="Response Rate"
              value={csat ? `${csat.totals?.response_rate_percent ?? 0}%` : '-'}
              subtext={`${csat?.totals?.feedback_responses ?? 0}/${csat?.totals?.completed_sessions ?? 0} sessions`}
              icon={Users}
              color="purple"
            />
            <StatCard
              title="NPS Score"
              value={csat?.metrics?.nps_score ?? '-'}
              subtext="Promoters - Detractors"
              icon={Shield}
              color="amber"
            />
            <StatCard
              title="Responses"
              value={csat?.totals?.feedback_responses ?? 0}
              subtext="Feedback submissions"
              icon={Clock}
              color="cyan"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">NPS Buckets</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-red-50 px-2 py-2 dark:bg-red-900/30">
                  <p className="text-xs text-red-600 dark:text-red-300">Detractors (0-6)</p>
                  <p className="text-lg font-semibold text-red-700 dark:text-red-200">
                    {csat?.metrics?.nps_buckets?.detractors ?? 0}
                  </p>
                </div>
                <div className="rounded-md bg-yellow-50 px-2 py-2 dark:bg-yellow-900/30">
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">Passives (7-8)</p>
                  <p className="text-lg font-semibold text-yellow-800 dark:text-yellow-200">
                    {csat?.metrics?.nps_buckets?.passives ?? 0}
                  </p>
                </div>
                <div className="rounded-md bg-green-50 px-2 py-2 dark:bg-green-900/30">
                  <p className="text-xs text-green-700 dark:text-green-300">Promoters (9-10)</p>
                  <p className="text-lg font-semibold text-green-800 dark:text-green-200">
                    {csat?.metrics?.nps_buckets?.promoters ?? 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                Recommendation Distribution (1-10)
              </p>
              <div className="grid grid-cols-10 gap-1">
                {(csat?.metrics?.recommend_distribution || []).map((item) => (
                  <div key={item.score} className="rounded bg-gray-100 px-1 py-1 text-center dark:bg-gray-700/60">
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{item.score}</p>
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{item.count}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                Daily Trend
              </p>
              <div className="max-h-56 overflow-y-auto">
                {(csat?.trend || []).length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No trend points for this range.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                        <th className="py-1">Day</th>
                        <th className="py-1">Resp</th>
                        <th className="py-1">Avg ★</th>
                        <th className="py-1">Avg Rec</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csat.trend.map((row) => (
                        <tr key={row.day} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="py-1.5 text-gray-700 dark:text-gray-200">{row.day}</td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-300">{row.feedback_count}</td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-300">{row.avg_call_rating}</td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-300">{row.avg_recommend_score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                Recent Feedback Notes
              </p>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {(csat?.recent_feedback || []).length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No written feedback yet.</p>
                ) : (
                  csat.recent_feedback.map((row, idx) => (
                    <div key={`${row.submitted_at}-${idx}`} className="rounded border border-gray-100 p-2 dark:border-gray-700">
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>{new Date(row.submitted_at).toLocaleString()}</span>
                        <span>★ {row.call_rating} | Rec {row.csat_recommend_score}/10</span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-200">{row.call_feedback}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Real Conversation Outcomes */}
        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Real Conversation Outcomes
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Notes-page check-ins after real conversations: it went well vs it was tough.
              </p>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">Range: {timeRange}</span>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              title="Outcome Responses"
              value={csat?.outcomes?.totals?.responses ?? 0}
              subtext="Total submissions"
              icon={Users}
              color="blue"
            />
            <StatCard
              title="It Went Well"
              value={csat?.outcomes?.totals?.well ?? 0}
              subtext="Positive outcomes"
              icon={CheckCircle}
              color="emerald"
            />
            <StatCard
              title="It Was Tough"
              value={csat?.outcomes?.totals?.tough ?? 0}
              subtext="Hard outcomes"
              icon={XCircle}
              color="amber"
            />
            <StatCard
              title="Tough Rate"
              value={csat ? `${csat?.outcomes?.totals?.tough_rate_percent ?? 0}%` : '-'}
              subtext="Tough / total"
              icon={TrendingUp}
              color="purple"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                Daily Outcome Trend
              </p>
              <div className="max-h-56 overflow-y-auto">
                {(csat?.outcomes?.trend || []).length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No outcome check-ins for this range.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                        <th className="py-1">Day</th>
                        <th className="py-1">Total</th>
                        <th className="py-1">Well</th>
                        <th className="py-1">Tough</th>
                        <th className="py-1">Tough %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(csat?.outcomes?.trend || []).map((row) => (
                        <tr key={row.day} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="py-1.5 text-gray-700 dark:text-gray-200">{row.day}</td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-300">{row.total}</td>
                          <td className="py-1.5 text-emerald-600 dark:text-emerald-300">{row.well}</td>
                          <td className="py-1.5 text-amber-600 dark:text-amber-300">{row.tough}</td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-300">{row.tough_rate_percent}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                Recent Outcome Notes
              </p>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {(csat?.outcomes?.recent || []).length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No outcome responses yet.</p>
                ) : (
                  (csat?.outcomes?.recent || []).map((row, idx) => (
                    <div key={`${row.created_at}-${row.session_id}-${idx}`} className="rounded border border-gray-100 p-2 dark:border-gray-700">
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>{new Date(row.created_at).toLocaleString()}</span>
                        <span className={row.outcome === 'well' ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}>
                          {row.outcome === 'well' ? 'It went well' : 'It was tough'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Session: {row.session_id}</p>
                      <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                        {row.user_note && row.user_note.trim().length > 0 ? row.user_note : 'No note provided.'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Two column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Recent Crisis Detections */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Recent Crisis Detections
              </h2>
              <span className="text-xs text-gray-500">
                Last {timeRange}
              </span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-80 overflow-y-auto">
              {recentCrisis.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  No crisis detections in this period
                </div>
              ) : (
                recentCrisis.map((crisis, index) => (
                  <div key={index} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <div className="flex items-center justify-between mb-1">
                      <CrisisLevelBadge level={crisis.detection_level} />
                      <span className="text-xs text-gray-400">
                        {new Date(crisis.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                      {crisis.message_text}
                    </p>
                    {crisis.escalated_to_human && (
                      <span className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <Eye className="w-3 h-3" /> Escalated
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Active Dependency Flags */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-500" />
                Active Dependency Flags
              </h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-80 overflow-y-auto">
              {dependencyFlags.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  No active dependency concerns
                </div>
              ) : (
                dependencyFlags.map((flag, index) => (
                  <div key={index} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        flag.severity === 'HIGH' 
                          ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
                      }`}>
                        {flag.severity} - {flag.flag_type}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(flag.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                      {flag.evidence}
                    </p>
                    {!flag.intervention_sent && (
                      <button className="text-xs text-blue-500 mt-1 hover:underline">
                        Send intervention
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Recent Content Filters */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-500" />
              Recent Content Filter Activity
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-4 py-2">Time</th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-4 py-2">Type</th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-4 py-2">Action</th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-4 py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {recentFilters.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                      No content filter activity
                    </td>
                  </tr>
                ) : (
                  recentFilters.map((filter, index) => (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                        {new Date(filter.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          {filter.trigger_type}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          filter.action_taken === 'BLOCKED'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'
                        }`}>
                          {filter.action_taken}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                        {filter.modification_reason || filter.trigger_details}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-gray-400">
          Dashboard auto-refreshes every 30 seconds when enabled.
          For HIPAA/privacy compliance, message content is not stored after 30 days.
        </div>

      </div>
    </div>
  );
}

export default AdminDashboard;
