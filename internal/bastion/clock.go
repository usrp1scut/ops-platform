package bastion

import "time"

// nowPlusSeconds returns now + n seconds. Pulled out so tests can swap the
// clock if/when we add timed expiry tests.
func nowPlusSeconds(n int) time.Time {
	return time.Now().Add(time.Duration(n) * time.Second)
}
