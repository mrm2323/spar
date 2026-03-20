# Kabir AI Deployment Checklist

## ⚠️ BEFORE EVERY DEPLOYMENT

### Automated (CI/CD handles these)
- [ ] All safety tests pass (crisis detection, content safety, jailbreak resistance)
- [ ] Build succeeds
- [ ] Linting passes

### Manual Review Required
- [ ] Reviewed any changes to crisis detection patterns
- [ ] Reviewed any changes to blocked content patterns
- [ ] Reviewed any changes to system prompts
- [ ] Checked dashboard for unusual activity in past 24 hours

## 🚨 CRITICAL CHECKS

### Never deploy if:
- [ ] Any CRITICAL crisis detection test fails
- [ ] Any content blocking test fails
- [ ] Any jailbreak resistance test fails
- [ ] There are unresolved CRITICAL crisis logs from past 24 hours

### After deployment:
- [ ] Monitor dashboard for 30 minutes
- [ ] Check for error spikes
- [ ] Verify crisis detection still working (send test message)

## 📞 Emergency Rollback

If any safety issue is discovered post-deployment:

1. Immediately roll back to previous version in Vercel
2. Create incident report
3. Fix issue and add test coverage
4. Re-deploy only after all tests pass

## Contact

For safety concerns:
- Check dashboard: /admin
- Emergency: [Your contact info]
