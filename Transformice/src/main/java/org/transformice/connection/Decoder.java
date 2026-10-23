package org.transformice.connection;

// Imports
import java.util.Arrays;
import org.bytearray.ByteArray;
import io.netty.buffer.ByteBuf;
import io.netty.channel.Channel;
import io.netty.channel.ChannelFutureListener;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ByteToMessageDecoder;
import io.netty.handler.codec.CorruptedFrameException;
import org.transformice.Application;

public class Decoder extends ByteToMessageDecoder {
    private static final byte[] POLICY_REQUEST = "<policy-file-request/>".getBytes();
    // ponytail: cap inbound frames at 1 MiB; raise if a supported upload needs more.
    private static final int MAX_PACKET_LENGTH = 1024 * 1024;

    @Override
    protected void decode(ChannelHandlerContext context, ByteBuf buffer, java.util.List<Object> output) throws CorruptedFrameException {
        if (buffer.readableBytes() < 2) {
            return;
        }

        // Every partial frame must rewind to its own start, never a previous frame.
        buffer.markReaderIndex();
        if (buffer.readableBytes() >= POLICY_REQUEST.length + 1) {
            byte[] incoming = new byte[POLICY_REQUEST.length + 1];
            buffer.readBytes(incoming);
            if (Arrays.equals(Arrays.copyOf(incoming, POLICY_REQUEST.length), POLICY_REQUEST) && incoming[POLICY_REQUEST.length] == 0) {
                Application.getLogger().warn("Policy file request.");
                context.writeAndFlush("<cross-domain-policy><allow-access-from domain=\"*\" to-ports=\"*\" /></cross-domain-policy>").addListener(ChannelFutureListener.CLOSE);
                return;
            }

            buffer.resetReaderIndex();
        }

        long length = 0;
        int shift = 0;
        while (true) {
            if (!buffer.isReadable()) {
                buffer.resetReaderIndex();
                return;
            }

            byte b = buffer.readByte();
            length |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) {
                break;
            }

            shift += 7;
            if (shift > 28) {
                throw new CorruptedFrameException("VLQ length field too long");
            }
        }

        if (length < 2 || length > MAX_PACKET_LENGTH) {
            throw new CorruptedFrameException("Invalid packet length: " + length);
        }

        // The protocol length excludes the fingerprint byte.
        if (buffer.readableBytes() < length + 1) {
            buffer.resetReaderIndex();
            return;
        }

        byte[] packetData = new byte[(int) length + 1];
        buffer.readBytes(packetData);
        output.add(new ByteArray(packetData));
    }
}
