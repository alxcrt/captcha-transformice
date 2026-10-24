package org.transformice.connection;

import java.nio.charset.StandardCharsets;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelOutboundHandlerAdapter;
import io.netty.channel.ChannelPromise;

public class Encoder extends ChannelOutboundHandlerAdapter {
    @Override
    public void write(ChannelHandlerContext context, Object message, ChannelPromise promise) {
        if (message instanceof String text) {
            context.write(Unpooled.copiedBuffer(text, StandardCharsets.UTF_8), promise);
        } else {
            // Transfer ownership to the next outbound handler without releasing
            // a ByteBuf that the transport still needs to send.
            context.write(message, promise);
        }
    }
}
