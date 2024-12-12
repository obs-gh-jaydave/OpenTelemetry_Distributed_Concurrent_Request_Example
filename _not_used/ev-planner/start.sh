#!/bin/sh
echo "Starting ev-planner..."
env

echo "Waiting for api-valhalla to be ready..."
API_VALHALLA_URL="http://api-valhalla:3000/health"
for i in $(seq 1 20); do
    if curl -sf "$API_VALHALLA_URL" > /dev/null; then
        echo "api-valhalla is ready."
        break
    fi
    echo "Retrying in 5 seconds..."
    sleep 5
done

# Run ev-planner in debug mode
echo "Starting ev-planner process..."
/usr/local/bin/ev-planner || echo "ev-planner exited with code $?"

# Keep the container alive
echo "Entering sleep loop for debugging..."
while true; do sleep 10; done
