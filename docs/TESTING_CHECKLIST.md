# Phoenix Closed Beta Testing Checklist

## Build

- [x] Install dependencies from `frontend/`
- [x] Run lint and TypeScript validation
- [x] Generate the native Android project with Expo prebuild
- [ ] Assemble a release APK

## Android TV and Fire TV

- [ ] Cold launch and warm launch
- [ ] D-pad navigation never loses focus
- [ ] Controls hide after 15 seconds and return on remote input
- [ ] Rapidly change channels for two minutes
- [ ] Browse the guide several hours forward and return to Now
- [ ] Leave playback running for at least 60 minutes
- [ ] Force-close and verify last-channel behavior
- [ ] Test offline launch using the last-good cache

## Performance

- [ ] Record cold-start time
- [ ] Record cached guide-open time
- [ ] Check memory before and after guide stress test
- [ ] Confirm background refresh does not interrupt playback
