package main

import (
    "fmt"
    "log"
    "net"
    "github.com/gorilla/websocket"
    "net/http"
)

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool {
        return true // Allow all origins for testing
    },
}

func proxyHandler(targetHost string, targetPort int) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // Upgrade HTTP to WebSocket
        wsConn, err := upgrader.Upgrade(w, r, nil)
        if err != nil {
            log.Printf("WebSocket upgrade failed: %v", err)
            return
        }
        defer wsConn.Close()

        // Connect to target TCP server
        tcpConn, err := net.Dial("tcp", fmt.Sprintf("%s:%d", targetHost, targetPort))
        if err != nil {
            log.Printf("TCP connection failed: %v", err)
            return
        }
        defer tcpConn.Close()

        log.Printf("Proxying WebSocket to %s:%d", targetHost, targetPort)

        // Proxy data bidirectionally
        errChan := make(chan error, 2)

        // WebSocket -> TCP
        go func() {
            for {
                messageType, data, err := wsConn.ReadMessage()
                if err != nil {
                    errChan <- err
                    return
                }
                if messageType == websocket.BinaryMessage {
                    _, err = tcpConn.Write(data)
                    if err != nil {
                        errChan <- err
                        return
                    }
                }
            }
        }()

        // TCP -> WebSocket
        go func() {
            buffer := make([]byte, 4096)
            for {
                n, err := tcpConn.Read(buffer)
                if err != nil {
                    errChan <- err
                    return
                }
                err = wsConn.WriteMessage(websocket.BinaryMessage, buffer[:n])
                if err != nil {
                    errChan <- err
                    return
                }
            }
        }()

        // Wait for error
        err = <-errChan
        log.Printf("Connection closed: %v", err)
    }
}

func main() {
    // Set up handlers for each port
    http.HandleFunc("/11801", proxyHandler("localhost", 11801))
    http.HandleFunc("/12801", proxyHandler("localhost", 12801))
    http.HandleFunc("/13801", proxyHandler("localhost", 13801))
    http.HandleFunc("/14801", proxyHandler("localhost", 14801))

    // Start server
    log.Println("WebSocket proxy starting on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}