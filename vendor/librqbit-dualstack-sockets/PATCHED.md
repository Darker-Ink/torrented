Vendored copy of `librqbit-dualstack-sockets` 0.7.0 with one change:
binding the IPv6 wildcard address falls back to the IPv4 wildcard when the
host has IPv6 disabled (socket creation fails with EAFNOSUPPORT). Without it
librqbit can't start its UDP tracker client on such hosts.

Remove once upstream handles this.
